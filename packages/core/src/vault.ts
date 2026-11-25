import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/** A login an employee may use. The model never sees these values; tools type them straight into the browser. */
export interface Credential {
  username: string;
  password: string;
  /** Base32 TOTP secret (the text under the QR code when you turn on an authenticator app). Optional. */
  totpSecret?: string;
}

interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

/**
 * The vault keeps logins on this computer, encrypted with AES-256-GCM.
 * The key is $DUDE_VAULT_KEY (64 hex chars) or `.dude/vault.key`, made on first use with owner-only permissions.
 * Values only leave the vault inside the runtime: `vault_fill` types them into the employee's own browser,
 * and every tool result is scrubbed of them before the model or the transcript sees it.
 */
export class Vault {
  private file: string;
  private keyFile: string;

  constructor(private home: string) {
    this.file = path.join(home, "vault.json");
    this.keyFile = path.join(home, "vault.key");
  }

  private key(): Buffer {
    const env = process.env.DUDE_VAULT_KEY;
    if (env) {
      if (!/^[0-9a-fA-F]{64}$/.test(env)) throw new Error("DUDE_VAULT_KEY must be 64 hex characters (32 bytes)");
      return Buffer.from(env, "hex");
    }
    if (!fs.existsSync(this.keyFile)) {
      fs.mkdirSync(this.home, { recursive: true });
      fs.writeFileSync(this.keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    return Buffer.from(fs.readFileSync(this.keyFile, "utf8").trim(), "hex");
  }

  private readAll(): Record<string, Sealed> {
    if (!fs.existsSync(this.file)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) ?? {};
    } catch {
      return {};
    }
  }

  private writeAll(all: Record<string, Sealed>) {
    fs.mkdirSync(this.home, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }

  has(id: string) {
    return !!this.readAll()[id];
  }

  ids() {
    return Object.keys(this.readAll());
  }

  set(id: string, cred: Credential) {
    if (!cred.username?.trim() || !cred.password) throw new Error("A login needs a username and a password");
    if (cred.totpSecret) totp(cred.totpSecret); // validates the secret
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(cred), "utf8"), cipher.final()]);
    const all = this.readAll();
    all[id] = { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    this.writeAll(all);
    this.cache = null;
  }

  get(id: string): Credential | null {
    const sealed = this.readAll()[id];
    if (!sealed) return null;
    const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const plain = Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
    return JSON.parse(plain) as Credential;
  }

  remove(id: string) {
    const all = this.readAll();
    const had = !!all[id];
    delete all[id];
    this.writeAll(all);
    this.cache = null;
    return had;
  }

  /** Username (safe to show) for an entry, without decrypting the rest for callers. */
  username(id: string) {
    try {
      return this.get(id)?.username ?? null;
    } catch {
      return null;
    }
  }

  private cache: string[] | null = null;

  /** Every secret value (passwords, TOTP secrets), longest first, for scrubbing tool output. */
  secrets(): string[] {
    if (this.cache) return this.cache;
    const out: string[] = [];
    for (const id of this.ids()) {
      try {
        const c = this.get(id);
        if (c?.password && c.password.length >= 4) out.push(c.password);
        if (c?.totpSecret && c.totpSecret.length >= 4) out.push(c.totpSecret);
      } catch {
        /* an entry sealed with another key: nothing to scrub */
      }
    }
    this.cache = out.sort((a, b) => b.length - a.length);
    return this.cache;
  }

  /** Replace any vault secret inside a value (string or JSON) with a placeholder. */
  redact<T>(value: T): T {
    return scrub(value, this.secrets(), "[hidden by vault]");
  }
}

/** Replace secrets in every string inside a value. Also catches them escaped, as tools print them in code or JSON. */
export function scrub<T>(value: T, secrets: string[], placeholder: string): T {
  if (!secrets.length) return value;
  const forms = new Set<string>();
  for (const s of secrets) {
    const json = JSON.stringify(s).slice(1, -1);
    const js = s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    for (const f of [s, json, js]) forms.add(f);
  }
  const list = [...forms].sort((a, b) => b.length - a.length);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return list.reduce((text, f) => (text.includes(f) ? text.split(f).join(placeholder) : text), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(v))) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [walk(k), walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

// ── TOTP (RFC 6238), so employees can pass two-step sign-in on their own ──────
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error("A TOTP secret is base32 text (letters A-Z and digits 2-7)");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, at = Date.now(), step = 30, digits = 6, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  return hotp(base32Decode(secret), Math.floor(at / 1000 / step), digits, algo);
}

export function hotp(key: Buffer, counter: number, digits = 6, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algo, key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}
