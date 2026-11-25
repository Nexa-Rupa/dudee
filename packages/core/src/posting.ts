import path from "node:path";
import { PLATFORMS, type SocialAccount } from "./social.js";

/**
 * After the user approves one post, the employee may publish exactly that post without a prompt for every click.
 * The window covers one account, for a few minutes: browser steps count only on that account's own site, text typed
 * must come from the approved post, uploads must be its approved media, and app calls must post through that app.
 * Anything else asks as usual.
 */
export interface PostingWindow {
  until: number;
  account: SocialAccount;
  text: string;
  title?: string;
  /** Full paths of the approved media files. */
  media: string[];
}

/** `site` = fine, as long as the browser is on the account's site. */
export type PostingVerdict = "yes" | "site" | "no";

/** Is this page on the account's own site (its platform's domains, or the exact sign-in page host the user set)? */
export function onAccountSite(account: SocialAccount, pageUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (account.loginUrl) {
    try {
      if (new URL(account.loginUrl).host === url.host) return true;
    } catch {
      /* a bad saved address matches nothing */
    }
  }
  if (url.port) return false;
  const domains: readonly string[] = PLATFORMS[account.platform].domains;
  return domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));
}

/** Does an approved post cover this tool call? */
export function postingVerdict(w: PostingWindow, tool: string, input: any): PostingVerdict {
  if (w.account.method === "composio") return tool.startsWith("apps__") && appCallOk(w, tool, input) ? "yes" : "no";
  switch (tool) {
    case "vault_fill": // checks the page itself before typing
      return String(input?.account ?? "") === w.account.id ? "yes" : "no";
    case "browser_click":
    case "browser_hover":
    case "browser_drag":
    case "browser_select_option":
      return "site";
    case "browser_press_key": // named keys and shortcuts; single characters could spell out other text
      return [...String(input?.key ?? "")].length > 1 ? "site" : "no";
    case "browser_type":
      return approvedText(w, input?.text) ? "site" : "no";
    case "browser_fill_form": {
      const fields: any[] = Array.isArray(input?.fields) ? input.fields : [];
      return fields.length && fields.every((f) => f?.type === "checkbox" || f?.type === "radio" || approvedText(w, f?.value)) ? "site" : "no";
    }
    case "browser_handle_dialog":
      return input?.promptText ? "no" : "site";
    case "browser_file_upload": {
      const paths: unknown[] = Array.isArray(input?.paths) ? input.paths : [];
      return paths.every((p) => w.media.some((m) => samePath(m, String(p)))) ? "site" : "no";
    }
    default:
      return "no";
  }
}

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Text that appears in the approved post or its title (the caption, or a piece of it). */
function approvedText(w: PostingWindow, text: unknown) {
  const t = norm(text);
  return norm(w.text).includes(t) || norm(w.title).includes(t);
}

function samePath(a: string, b: string) {
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

const POST_VERB = /(POST|CREAT|PUBLISH|UPLOAD|MEDIA|GET|LIST|FETCH|STATUS)/;
const OTHER_VERB = /(DELETE|REMOVE|MESSAGE|_DM|COMMENT|REPLY|FOLLOW|LIKE|REACT|BLOCK|MUTE|INVITE|UPDATE|EDIT)/;
const TEXT_ARG = /(text|caption|message|commentary|body|title|description|content|status)$/i;

/** Composio's execute call, when every action in it posts through this account's app with the approved words. */
function appCallOk(w: PostingWindow, tool: string, input: any): boolean {
  if (!/EXECUTE_TOOL$/.test(tool)) return false;
  const toolkit = PLATFORMS[w.account.platform].toolkit;
  const calls: any[] = Array.isArray(input?.tools) ? input.tools : [];
  if (!toolkit || !calls.length) return false;
  return calls.every((c) => {
    const slug = String(c?.tool_slug ?? "").toUpperCase();
    return slug.startsWith(`${toolkit.toUpperCase()}_`) && POST_VERB.test(slug) && !OTHER_VERB.test(slug) && textArgsOk(w, c?.arguments);
  });
}

function textArgsOk(w: PostingWindow, args: unknown, key = ""): boolean {
  if (typeof args === "string") return !TEXT_ARG.test(key) || approvedText(w, args);
  if (Array.isArray(args)) return args.every((a) => textArgsOk(w, a, key));
  if (args && typeof args === "object") return Object.entries(args).every(([k, v]) => textArgsOk(w, v, k));
  return true;
}
