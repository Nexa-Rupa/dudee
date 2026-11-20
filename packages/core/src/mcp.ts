import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Hire, McpServerConfig, Policy, ToolDef } from "./types.js";

export interface McpSource {
  /** Prefix for tool names (the server's name in config, or "browser"). */
  name: string;
  /** Cache key: one connection per key. */
  key: string;
  config: McpServerConfig;
  /** Keep the server's own tool names (no prefix). */
  bareNames?: boolean;
  policy?: (tool: string) => Policy | undefined;
  /** Called after each tool call with the connected client. */
  after?: (tool: string, client: Client) => void;
}

/**
 * Connected apps come in over MCP. Any MCP server works: Composio, Zapier, GitHub,
 * Notion, a company's own. Tools marked readOnlyHint run at once; everything else asks.
 */
export class McpHub {
  private clients = new Map<string, Promise<{ client: Client; tools: ToolDef[] }>>();

  constructor(private servers: Record<string, McpServerConfig>) {}

  /** Tools from every configured server this hire may use, plus extra per-hire sources. A failing server is skipped. */
  async toolsFor(hire: Hire, onError: (server: string, err: unknown) => void, extra: McpSource[] = []): Promise<ToolDef[]> {
    const sources: McpSource[] = [];
    for (const [name, cfg] of Object.entries(this.servers)) {
      if (cfg.hires && !cfg.hires.includes(hire.name) && !cfg.hires.includes(hire.id)) continue;
      sources.push({ name, key: name, config: cfg });
    }
    sources.push(...extra);
    const out: ToolDef[] = [];
    for (const src of sources) {
      try {
        out.push(...(await this.connect(src)).tools);
      } catch (err) {
        this.clients.delete(src.key);
        onError(src.name, err);
      }
    }
    return out;
  }

  private connect(src: McpSource) {
    let entry = this.clients.get(src.key);
    if (!entry) {
      entry = (async () => {
        const cfg = src.config;
        const client = new Client({ name: "dude", version: "0.1.0" });
        const transport =
          "url" in cfg
            ? new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } })
            : new StdioClientTransport({
                command: cfg.command,
                args: cfg.args ?? [],
                env: { ...(process.env as Record<string, string>), ...(cfg.env ?? {}) },
                stderr: "ignore",
              });
        await client.connect(transport);
        const { tools } = await client.listTools();
        const defs: ToolDef[] = tools.map((t) => {
          const policy = src.policy?.(t.name);
          return {
            name: src.bareNames ? t.name : toolName(src.name, t.name),
            description: src.bareNames ? (t.description ?? t.name) : `[${src.name}] ${t.description ?? t.name}`,
            input: { jsonSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown> },
            risk: t.annotations?.readOnlyHint ? "read" : "write",
            defaultPolicy: policy,
            summarize: (input: unknown) => `${src.name} → ${t.name} ${JSON.stringify(input).slice(0, 200)}`,
            async execute(input: unknown) {
              const res = await client.callTool({ name: t.name, arguments: (input ?? {}) as Record<string, unknown> });
              src.after?.(t.name, client);
              return res.structuredContent ?? res.content;
            },
          } satisfies ToolDef;
        });
        return { client, tools: defs };
      })();
      this.clients.set(src.key, entry);
    }
    return entry;
  }

  /** The connected client for a source (connecting if needed), for calls the runtime makes itself. */
  async client(src: McpSource) {
    return (await this.connect(src)).client;
  }

  /** Close one connection (e.g. a fired employee's browser). */
  async closeKey(key: string) {
    const entry = this.clients.get(key);
    this.clients.delete(key);
    if (entry) await entry.then((e) => e.client.close()).catch(() => {});
  }

  async close() {
    for (const key of [...this.clients.keys()]) await this.closeKey(key);
  }
}

function toolName(server: string, tool: string) {
  return `${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}
