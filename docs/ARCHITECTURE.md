# Architecture

```text
 front ends                       @dude/core                                outside
 ──────────                       ──────────                                ───────
 dude CLI ─┐                 ┌─ Runtime ─ one queue per employee ─┐
 web app  ─┼─ events/rows ◄──┤    turn = streamText + tools       ├──► model provider (user's key)
 cloud    ─┘   approvals ──► │  Tools: web, files, memory, team,  ├──► MCP servers (apps)
                             │         routines, phone, MCP       ├──► Vapi (calls)
                             │  Store (sqlite) · Memory (MD) ·    │
                             └─ Scheduler (cron routines) ────────┘
```

## Pieces

| Piece | File | What it does |
|---|---|---|
| Runtime | `packages/core/src/runtime.ts` | Hires and fires, builds each employee's prompt and tools, runs turns on a per-employee serial queue, records every step as a row and an event |
| Turn | `Runtime.turn` | One `streamText` call from the Vercel AI SDK with the employee's tools and up to `maxSteps` steps. Text arrives as `delta` events; each tool call becomes a `tool` row |
| Approvals | `Runtime.policyFor`, `runTool` | Inside the tool call: `auto` runs, `ask` waits on the `approve` handler, `deny` hides the tool. Order: workspace or pack `deny` → `alwaysAsk` tools → the user's "always allow" → workspace config → pack → tool default → read tools auto, write tools ask |
| Packs | `packs.ts`, `packages/employees/packs/*` | Role definitions: tools, approvals, routines, instructions, skills |
| Tools | `tools/builtin.ts`, `tools/phone.ts` | Built-in groups a pack lists by name. `memory`, `skills`, `ask_user`, `team`, `files` are always on |
| Apps | `mcp.ts` | Connects MCP servers (stdio or HTTP), prefixes tool names with the server name, uses `readOnlyHint` to pick the risk |
| What each step sends | `engine.ts` | Adds what the user said meanwhile, drops old browser pages in batches, marks the prompt for Claude's cache, prices cached tokens, turns attachments and screenshots into what each provider accepts |
| Stop and steer | `Runtime.stop`, `Runtime.tell` | Stop aborts the model call, open cards, commands and teammates working for the task. A message sent meanwhile joins the task at its next step, or becomes the next task |
| Fallbacks | `Runtime.runTurn` | `fallbackModels` carry on from the last finished step. Not after a failed step that already called a tool |
| Tool search | `Runtime.buildTools` | With more than 25 app tools, they are found with `find_tools` instead of being sent every step |
| Waiting for people | `Runtime.untilAnswered` | Cards from work someone asked for stay open. Cards from routines and webhooks (and teammates they ask) expire after `approvalTimeoutMin` (30 by default) as "not allowed" |
| Teammates | `Runtime.delegate` | Refuses a request that would leave two employees waiting on each other |
| Budgets | `Runtime.turn`, `pricing.ts` | Usage is saved after every step, so failed turns count and a turn stops at the step that reaches a budget. With a budget set, a model without a price is refused |
| Web pages | `net.ts` | `web_fetch` connects only to public addresses, checked at connection time and on every redirect (`DUDE_ALLOW_PRIVATE_FETCH=1` lifts this) |
| Child processes | `env.ts` | Commands and video renders get a clean environment without keys; add names with `DUDE_SHELL_ENV`. Known keys are scrubbed from tool output. This is not a sandbox |
| Memory | `memory.ts` | `MEMORY.md` per employee, added to the system prompt. At 12,000 characters saving is refused until notes are merged (`memory_update`) or removed |
| Team files | `team.ts` | Export and import. "Always allow" rules in a file are listed but never applied |
| Store | `store.ts` | `node:sqlite`: hires, transcript rows, policies, routines and their runs, open work, usage |
| Scheduler | `scheduler.ts` | Runs enabled routines with croner; each run is a turn from `routine:<id>` |
| Webhooks | `packages/server` | `POST /api/hooks/<employee id>/<routine id>` with the routine's own key (`?key=`, `x-hook-key` or a bearer token). The body (up to 100 KB) reaches the employee marked as outside information |
| Providers | `providers.ts` | Registry of 17 chat providers (Anthropic, OpenAI, Google, and OpenAI-compatible ones from Groq to 9router and Ollama) plus custom endpoints from config. Resolves `provider:model`, lists a key's models, and keeps keys saved from the UI in `.dude/secrets.env` (real env vars win) |
| Skills | `skills.ts` | Agent Skills discovery from the pack, `.dude/skills`, the project's `.agents`/`.claude` skills and the user's global ones; `use_skill` loads a body, `read_skill_file` loads bundled files, `/name args` in a message runs one; `installSkills` copies skills from a folder or clone |
| Media | `tools/media.ts` | fal.ai queue API: `generate_image` and `fal_run` (any model), results saved under `files/media/` |
| Shell | `tools/shell.ts` | Opt-in `run_command` in the employee's files folder, for skill scripts; asks every time unless always-allowed |
| Browser | `tools/browser.ts` | Packs listing `browser` get a Playwright MCP server per employee (own profile and output folder under `.dude/team/<id>/`). Browsing runs freely, clicking and typing ask, raw JS is off. After each step that changes the page the runtime takes a screenshot and emits a `screen` event |
| Vault | `vault.ts` | AES-256-GCM logins in `.dude/vault.json` (key in `.dude/vault.key` or `DUDE_VAULT_KEY`), TOTP codes, and redaction of every tool result so saved secrets never reach the model or the transcript |
| Connected apps | `composio.ts` | One Composio Tool Router Session per workspace; its MCP endpoint becomes `apps__*` tools for every employee (or `composioHires`); lookups auto, executes ask |
| Social | `social.ts` | Social accounts, autopost plans (each a routine with source `autopost`), the post log, `social_publish_request` (one approval opens a 20-minute window for that post: see `posting.ts`) and `vault_fill`, which checks the browser's real address before typing |
| Video | `tools/video.ts` | `video_render`: Remotion specs through a shared studio in `.dude/studio/remotion`, or HyperFrames projects; `generate_voiceover` (ElevenLabs or OpenAI) |
| Telegram | `packages/server/src/telegram.ts` | Long-polling bot: pairing codes, messages to employees, approval buttons, question replies, routine reports |
| Server | `packages/server` | `node:http` on 127.0.0.1 with a per-run token: JSON API, one SSE stream of runtime events, approvals and questions held as cards until answered, routines scheduler, serves the built web app |
| Web app | `apps/web` | React + Vite. Sidebar with live status, chat grouped into turns (request → steps → reply), live "Working for 12s · 3 steps" chip, approval and question cards, panel with Screen, Files, Memory, Routines, About |

## Seams the cloud plugs into

The cloud does not fork the runtime. It passes its own implementations through `RuntimeOptions`:

| Seam | Self-hosted | Cloud |
|---|---|---|
| `approve` | terminal prompt | approval card in the web app and on mobile |
| `ask` | terminal prompt | question card |
| `meter` | local `usage` table | billing events (Stripe meters) |
| `resolveModel` | user's own keys | metered model gateway, or the customer's keys |
| `mcpServers` | config file | managed Composio connections per workspace |
| `Store` | sqlite file | Postgres, one schema per workspace (next refactor: make Store an interface) |

## Transcript model

Each employee has an append-only list of rows: `message` (user, assistant, or a teammate or routine shown in `from`), `tool` (name, input, output or error, duration), `approval` (summary and decision), `notice`. A front end replays rows and streams new ones from events. The model only sees the last 40 message rows plus memory; tool results stay in the transcript for people, not in the next prompt.

## Roadmap

1. **Done:** core runtime, CLI, four packs, approvals, MCP, routines, teammates, tests with a scripted model.
2. **Done:** local web app (`dude ui`) with live steps, approval and question cards, files, memory and routines; `pnpm demo` without a key.
3. **Done:** a browser per employee (Playwright MCP, own profile, screenshots in the Screen tab).
4. **Next: a full computer per employee** (Docker with noVNC, or a hosted VM provider) with a streamed live view and take-over in the web app, as in bot-hq. Needed for the cloud, where there is no local window to watch.
5. **Pack registry:** `dude add <github-user/pack>`; evals per pack.
6. **Cloud:** see [cloud/README.md](../cloud/README.md).
7. **Voice in:** talk to an employee (realtime voice model) and inbound calls for the Calling Agent.

## Relation to the earlier projects

- `legacy/cloud-v0/` is the first SaaS prototype (Next.js, Better Auth, Drizzle, BullMQ, Stripe). Its auth, billing, vault and onboarding UI are worth porting into the cloud app; its agent code (`brain-adapter`, `skills`, `employeeos-*` copies) is replaced by `@dude/core`.
- The earlier open-source "company brain" (Dudee / EmployeeOS) ideas map onto this core: the morning brief and weekly review become routines, goals and health score become memory and a reporting pack, and its native GitHub runner and Composio adapter become tool groups or MCP servers.
