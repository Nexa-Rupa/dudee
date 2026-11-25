import { randomInt } from "node:crypto";
import { errorText, saveConfig, type ApprovalDecision, type Hire, type Runtime } from "@dude/core";

/**
 * Talk to your team from Telegram. Make a bot with @BotFather, paste its token as TELEGRAM_BOT_TOKEN, then message
 * the bot: it answers with a pairing code you approve in Connections. Paired chats can:
 *  - message an employee ("Maya: post about our launch", "@Leo draft a thread", or just text the default one),
 *  - answer approval cards with buttons (Allow / Always / Don't allow) and employees' questions by replying,
 *  - get what routines did (a daily autopost's report) as it happens.
 * Long polling, so it works behind NAT with no public address.
 */
export interface TelegramHooks {
  approvals: () => Array<{ id: string; hireId: string; summary: string }>;
  answerApproval: (id: string, decision: ApprovalDecision) => boolean;
  answerQuestion: (id: string, answer: string | null) => boolean;
  broadcast: (event: object) => void;
  log: (line: string) => void;
}

export interface Pairing {
  code: string;
  chatId: number;
  name: string;
  at: string;
}

const API = "https://api.telegram.org";

export class TelegramBridge {
  private offset = 0;
  private running = false;
  private abort?: AbortController;
  private token: string | null = null;
  readonly pending = new Map<string, Pairing>();
  /** Telegram message id → question id, so a reply answers the right question. */
  private questionMessages = new Map<string, string>();
  /** Per chat: the employee they last talked to. */
  private lastHire = new Map<number, string>();
  /** Employees whose current turn came from a routine, so its reply is forwarded. */
  private routineTurns = new Set<string>();
  botName: string | null = null;
  lastError: string | null = null;
  private unsubscribe?: () => void;

  constructor(
    private runtime: Runtime,
    private home: string,
    private hooks: TelegramHooks
  ) {}

  get configured() {
    return !!process.env.TELEGRAM_BOT_TOKEN;
  }

  get active() {
    return this.running;
  }

  private settings() {
    if (!this.runtime.config.telegram) this.runtime.config.telegram = { allowedChats: [], defaultHire: null, notify: true };
    return this.runtime.config.telegram;
  }

  start() {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token || this.running) return;
    this.token = token;
    this.running = true;
    this.lastError = null;
    this.unsubscribe = this.runtime.on((e) => {
      if (e.type !== "row") return;
      const row = e.row.row;
      if (row.kind === "message" && row.role === "user" && row.from?.startsWith("routine:")) this.routineTurns.add(e.hireId);
      if (row.kind === "message" && row.role === "assistant" && this.routineTurns.has(e.hireId)) {
        this.routineTurns.delete(e.hireId);
        if (this.settings().notify !== false && row.text) {
          const hire = this.runtime.findHire(e.hireId);
          void this.toAll(`${hire?.name ?? "An employee"} (scheduled work):\n${row.text}`);
        }
      }
    });
    void this.me();
    void this.loop();
  }

  async stop() {
    this.running = false;
    this.abort?.abort();
    this.unsubscribe?.();
  }

  async restart() {
    await this.stop();
    this.offset = 0;
    this.botName = null;
    this.start();
  }

  private async call(method: string, body: Record<string, unknown> = {}, signal?: AbortSignal): Promise<any> {
    if (!this.token) throw new Error("No Telegram bot token");
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`);
    return data.result;
  }

  private async me() {
    try {
      const me = await this.call("getMe");
      this.botName = me.username ? `@${me.username}` : me.first_name;
      this.hooks.broadcast({ type: "connections-changed" });
    } catch (err) {
      this.lastError = errorText(err);
      this.hooks.broadcast({ type: "connections-changed" });
    }
  }

  private async loop() {
    let backoff = 1000;
    while (this.running) {
      this.abort = new AbortController();
      try {
        const updates = await this.call(
          "getUpdates",
          { offset: this.offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
          AbortSignal.any([this.abort.signal, AbortSignal.timeout(40_000)])
        );
        backoff = 1000;
        for (const u of updates ?? []) {
          this.offset = u.update_id + 1;
          await this.handle(u).catch((err) => this.hooks.log(`✗ Telegram: ${errorText(err)}`));
        }
      } catch (err) {
        if (!this.running) break;
        this.lastError = errorText(err);
        if (/Unauthorized|401|404/.test(this.lastError)) {
          this.hooks.log(`✗ Telegram stopped: ${this.lastError}. Check TELEGRAM_BOT_TOKEN.`);
          this.running = false;
          this.hooks.broadcast({ type: "connections-changed" });
          break;
        }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  private allowed(chatId: number) {
    return this.settings().allowedChats.includes(chatId);
  }

  async send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
    const chunks = text.match(/[\s\S]{1,3900}/g) ?? [""];
    let last: any;
    for (const chunk of chunks) last = await this.call("sendMessage", { chat_id: chatId, text: chunk, ...extra });
    return last;
  }

  private async toAll(text: string, extra: Record<string, unknown> = {}) {
    const out: any[] = [];
    for (const chatId of this.settings().allowedChats) {
      try {
        out.push(await this.send(chatId, text, extra));
      } catch (err) {
        this.hooks.log(`✗ Telegram send: ${errorText(err)}`);
      }
    }
    return out;
  }

  /** A new approval card: send it with buttons to every paired chat. */
  async notifyApproval(card: { id: string; hireId: string; summary: string }) {
    if (!this.running) return;
    const hire = this.runtime.findHire(card.hireId);
    await this.toAll(`${hire?.name ?? "An employee"} wants to:\n${card.summary}`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Allow", callback_data: `a:${card.id}:allow` },
            { text: "Always allow", callback_data: `a:${card.id}:always` },
            { text: "Don't allow", callback_data: `a:${card.id}:deny` },
          ],
        ],
      },
    });
  }

  async notifyQuestion(q: { id: string; hireId: string; question: string }) {
    if (!this.running) return;
    const hire = this.runtime.findHire(q.hireId);
    const sent = await this.toAll(`${hire?.name ?? "An employee"} asks:\n${q.question}\n\n(Reply to this message to answer.)`, {
      reply_markup: { force_reply: true },
    });
    for (const m of sent) if (m?.message_id) this.questionMessages.set(`${m.chat.id}:${m.message_id}`, q.id);
  }

  /** Approve a chat that asked to pair. */
  pair(code: string) {
    const p = this.pending.get(code);
    if (!p) return false;
    this.pending.delete(code);
    const s = this.settings();
    if (!s.allowedChats.includes(p.chatId)) s.allowedChats.push(p.chatId);
    saveConfig(this.home, this.runtime.config);
    void this.send(p.chatId, `Connected. Message an employee by name ("Maya: post today's tip") or just write to ${this.defaultHire()?.name ?? "your team"}. Send /team to see everyone.`).catch(() => {});
    return true;
  }

  unpair(chatId: number) {
    const s = this.settings();
    s.allowedChats = s.allowedChats.filter((c) => c !== chatId);
    saveConfig(this.home, this.runtime.config);
  }

  private defaultHire(chatId?: number): Hire | null {
    const ref = (chatId !== undefined && this.lastHire.get(chatId)) || this.settings().defaultHire;
    return (ref && this.runtime.findHire(ref)) || this.runtime.listHires()[0] || null;
  }

  private async handle(u: any) {
    if (u.callback_query) {
      const q = u.callback_query;
      const chatId = q.message?.chat?.id;
      if (!this.allowed(chatId)) return this.call("answerCallbackQuery", { callback_query_id: q.id, text: "This chat is not paired." });
      const m = String(q.data ?? "").match(/^a:([\w-]+):(allow|always|deny)$/);
      const ok = m ? this.hooks.answerApproval(m[1], m[2] as ApprovalDecision) : false;
      await this.call("answerCallbackQuery", { callback_query_id: q.id, text: ok ? "Done" : "Already answered" });
      if (ok && q.message) {
        const label = m![2] === "deny" ? "Not allowed" : m![2] === "always" ? "Always allowed" : "Allowed";
        await this.call("editMessageReplyMarkup", { chat_id: chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: `✓ ${label}`, callback_data: "noop" }]] } }).catch(() => {});
      }
      return;
    }
    const msg = u.message;
    if (!msg?.chat || typeof msg.text !== "string") return;
    const chatId: number = msg.chat.id;
    const text = msg.text.trim();

    if (!this.allowed(chatId)) {
      let p = [...this.pending.values()].find((x) => x.chatId === chatId);
      if (!p) {
        p = {
          code: String(randomInt(100000, 999999)),
          chatId,
          name: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.chat.title || String(chatId),
          at: new Date().toISOString(),
        };
        this.pending.set(p.code, p);
        this.hooks.broadcast({ type: "connections-changed" });
      }
      return this.send(chatId, `This chat isn't connected to dudee yet. In the dudee app open Connections → Telegram and approve code ${p.code}.`);
    }

    // a reply to a question card answers it
    const replyTo = msg.reply_to_message?.message_id;
    if (replyTo) {
      const qid = this.questionMessages.get(`${chatId}:${replyTo}`);
      if (qid) {
        this.questionMessages.delete(`${chatId}:${replyTo}`);
        const ok = this.hooks.answerQuestion(qid, text);
        return this.send(chatId, ok ? "Thanks, passed on." : "That question was already answered.");
      }
    }

    if (text === "/start" || text === "/help") {
      return this.send(chatId, `Write to an employee by name: "Maya: post today's tip". Commands: /team, /pending, /stop <name>.`);
    }
    if (text === "/team") {
      const list = this.runtime.listHires().map((h) => `• ${h.name} — ${this.runtime.packFor(h)?.title ?? h.packId}${h.paused ? " (paused)" : ""}`);
      return this.send(chatId, list.length ? list.join("\n") : "No employees yet. Hire one in the app.");
    }
    const stop = text.match(/^\/stop(?:\s+(.+))?$/);
    if (stop) {
      const who = stop[1] ? this.runtime.findHire(stop[1].trim()) : this.defaultHire(chatId);
      if (!who) return this.send(chatId, stop[1] ? `No employee named ${stop[1].trim()}.` : "No employees yet.");
      return this.send(chatId, this.runtime.stop(who.id) ? `${who.name} stopped.` : `${who.name} isn't working on anything.`);
    }
    if (text === "/pending") {
      const cards = this.hooks.approvals();
      if (!cards.length) return this.send(chatId, "Nothing is waiting for you.");
      for (const c of cards) await this.notifyApproval(c);
      return;
    }

    let hire: Hire | null = null;
    let body = text;
    const named = text.match(/^@?([\p{L}\p{N} _.-]{1,40}?)\s*[:,]\s+([\s\S]+)$/u) ?? text.match(/^@([\p{L}\p{N}_.-]{1,40})\s+([\s\S]+)$/u);
    if (named) {
      const h = this.runtime.findHire(named[1].trim());
      if (h) {
        hire = h;
        body = named[2];
      }
    }
    hire ??= this.defaultHire(chatId);
    if (!hire) return this.send(chatId, "No employees yet. Hire one in the dudee app first.");
    this.lastHire.set(chatId, hire.id);
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    try {
      const reply = await this.runtime.send(hire.id, body);
      await this.send(chatId, `${hire.name}: ${reply || "(done)"}`);
    } catch (err) {
      await this.send(chatId, `${hire.name} couldn't do that: ${errorText(err)}`);
    }
  }
}
