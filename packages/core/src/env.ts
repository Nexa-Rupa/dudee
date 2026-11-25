import { MEDIA_PROVIDERS, allProviders } from "./providers.js";

/**
 * What programs an employee starts may see of this process's environment. Model keys, app keys and vault keys
 * stay out; programs get only what they need to run. Add names with DUDE_SHELL_ENV="MY_TOOL_TOKEN,OTHER".
 */
const PASS = new Set([
  ...["PATH", "PATHEXT", "HOME", "USER", "LOGNAME", "USERNAME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SHELL", "TERM"],
  ...["LANG", "LANGUAGE", "TZ", "TMP", "TEMP", "TMPDIR", "DISPLAY", "WAYLAND_DISPLAY"],
  ...["SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"],
  ...["APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "PUBLIC", "ALLUSERSPROFILE"],
  ...["COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_RUNTIME_DIR"],
  ...["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"],
  ...["NVM_DIR", "NVM_HOME", "NVM_SYMLINK", "VOLTA_HOME", "FNM_DIR", "PNPM_HOME", "JAVA_HOME", "VIRTUAL_ENV"],
]);

export function childEnv(extra: Record<string, string> = {}, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const also = new Set((env.DUDE_SHELL_ENV ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const key = name.toUpperCase(); // Windows names ignore case ("Path")
    if (value !== undefined && (PASS.has(key) || key.startsWith("LC_") || also.has(key))) out[name] = value;
  }
  return { ...out, ...extra };
}

const OTHER_KEYS = [
  "TAVILY_API_KEY",
  "BRAVE_API_KEY",
  "COMPOSIO_API_KEY",
  "ELEVENLABS_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "VAPI_API_KEY",
  "DUDE_VAULT_KEY",
  "DUDE_UI_TOKEN",
];

/** The values of every key dude knows about, for scrubbing tool output. */
export function knownKeyValues(env: NodeJS.ProcessEnv = process.env): string[] {
  const names = new Set<string>(OTHER_KEYS);
  for (const p of allProviders()) if (p.keyEnv) names.add(p.keyEnv);
  for (const m of MEDIA_PROVIDERS) names.add(m.keyEnv);
  return [...names].map((n) => env[n] ?? "").filter((v) => v.length >= 8);
}
