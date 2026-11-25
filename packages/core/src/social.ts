import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { onAccountSite } from "./posting.js";
import { totp } from "./vault.js";
import type { Runtime } from "./runtime.js";
import type { ToolContext, ToolDef } from "./types.js";

/**
 * Social accounts and daily autopost.
 *
 * The user adds an account (platform + handle) and picks how the employee reaches it:
 *  - `composio`: the app is connected over OAuth in Connections; the employee posts through `apps__*` tools.
 *  - `browser`: the user saves the login in the vault; the employee signs in with its own browser
 *    (`vault_fill` types the username, password and two-step code without the model ever seeing them) and posts there.
 *
 * An autopost plan turns into a routine on the assigned employee: every day at the chosen time it plans,
 * writes and makes the post (text, image or a video it renders itself with Remotion or HyperFrames),
 * then publishes through `social_publish_request`, which asks the user first unless the plan says
 * "post without asking".
 */
export const PLATFORMS = {
  x: { name: "X (Twitter)", toolkit: "twitter", domains: ["x.com", "twitter.com"], loginUrl: "https://x.com/i/flow/login", composeUrl: "https://x.com/compose/post", maxChars: 280, video: "16:9 or 9:16, up to 2:20" },
  linkedin: { name: "LinkedIn", toolkit: "linkedin", domains: ["linkedin.com"], loginUrl: "https://www.linkedin.com/login", composeUrl: "https://www.linkedin.com/feed/", maxChars: 3000, video: "16:9, 1:1 or 9:16, up to 10 min" },
  instagram: { name: "Instagram", toolkit: "instagram", domains: ["instagram.com"], loginUrl: "https://www.instagram.com/accounts/login/", composeUrl: "https://www.instagram.com/", maxChars: 2200, video: "9:16 reels, up to 90 s" },
  facebook: { name: "Facebook", toolkit: "facebook", domains: ["facebook.com"], loginUrl: "https://www.facebook.com/login", composeUrl: "https://www.facebook.com/", maxChars: 63206, video: "16:9, 1:1 or 9:16" },
  threads: { name: "Threads", toolkit: "threads", domains: ["threads.net", "threads.com", "instagram.com"], loginUrl: "https://www.threads.net/login", composeUrl: "https://www.threads.net/", maxChars: 500, video: "9:16, up to 5 min" },
  youtube: { name: "YouTube", toolkit: "youtube", domains: ["youtube.com", "accounts.google.com"], loginUrl: "https://accounts.google.com/ServiceLogin?service=youtube", composeUrl: "https://studio.youtube.com/", maxChars: 5000, video: "9:16 Shorts up to 60 s, or 16:9" },
  tiktok: { name: "TikTok", toolkit: "tiktok", domains: ["tiktok.com"], loginUrl: "https://www.tiktok.com/login", composeUrl: "https://www.tiktok.com/tiktokstudio/upload", maxChars: 2200, video: "9:16, 15-60 s works best" },
  reddit: { name: "Reddit", toolkit: "reddit", domains: ["reddit.com"], loginUrl: "https://www.reddit.com/login/", composeUrl: "https://www.reddit.com/submit", maxChars: 40000, video: "16:9 or 9:16" },
  pinterest: { name: "Pinterest", toolkit: "pinterest", domains: ["pinterest.com"], loginUrl: "https://www.pinterest.com/login/", composeUrl: "https://www.pinterest.com/pin-creation-tool/", maxChars: 500, video: "2:3 or 9:16" },
  other: { name: "Other site", toolkit: "", domains: [], loginUrl: "", composeUrl: "", maxChars: 2000, video: "check the site" },
} as const;

export type Platform = keyof typeof PLATFORMS;
export type PostFormat = "text" | "image" | "video" | "mix";
export type VideoEngine = "auto" | "remotion" | "hyperframes";

export interface AutopostPlan {
  enabled: boolean;
  /** Local time of day, HH:MM. */
  time: string;
  /** Weekdays 0 (Sun) to 6 (Sat); empty means every day. */
  days: number[];
  format: PostFormat;
  videoEngine: VideoEngine;
  /** What to post about: audience, voice, offers, do's and don'ts. */
  brief: string;
  /** Topics to rotate through. */
  topics: string[];
  /** ask = an approval card before every post; auto = post without asking. */
  approval: "ask" | "auto";
}

export interface SocialAccount {
  id: string;
  platform: Platform;
  handle: string;
  method: "browser" | "composio";
  /** Sign-in page for browser accounts; defaults to the platform's. */
  loginUrl: string | null;
  /** The employee who posts for this account. */
  hireId: string | null;
  autopost: AutopostPlan;
  createdAt: string;
}

export interface SocialPost {
  id: string;
  accountId: string;
  hireId: string;
  at: string;
  status: "awaiting" | "approved" | "posted" | "failed" | "declined";
  text: string;
  media: string[];
  url: string | null;
  error: string | null;
}

export const DEFAULT_PLAN: AutopostPlan = {
  enabled: false,
  time: "10:00",
  days: [],
  format: "mix",
  videoEngine: "auto",
  brief: "",
  topics: [],
  approval: "ask",
};

export function normalizePlan(p: Partial<AutopostPlan> = {}): AutopostPlan {
  const plan = { ...DEFAULT_PLAN, ...p };
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(plan.time)) throw new Error("Time must be HH:MM, e.g. 09:30");
  plan.days = [...new Set((plan.days ?? []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!["text", "image", "video", "mix"].includes(plan.format)) throw new Error("Format must be text, image, video or mix");
  if (!["auto", "remotion", "hyperframes"].includes(plan.videoEngine)) throw new Error("Video engine must be auto, remotion or hyperframes");
  if (!["ask", "auto"].includes(plan.approval)) throw new Error("Approval must be ask or auto");
  plan.brief = String(plan.brief ?? "").slice(0, 4000);
  plan.topics = (plan.topics ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 50);
  plan.enabled = !!plan.enabled;
  return plan;
}

export function planCron(plan: AutopostPlan) {
  const [h, m] = plan.time.split(":").map(Number);
  return `${m} ${h} * * ${plan.days.length && plan.days.length < 7 ? plan.days.join(",") : "*"}`;
}

export function routineIdFor(accountId: string) {
  return `autopost-${accountId}`;
}

export function autopostPrompt(a: SocialAccount) {
  const p = PLATFORMS[a.platform];
  const plan = a.autopost;
  return [
    `Daily autopost for ${p.name} account ${a.handle} (account id "${a.id}").`,
    `Use your daily-autopost skill and follow it end to end: pick today's angle, write the post, make the ${plan.format === "mix" ? "best format for today (text, image or video)" : plan.format}, then publish it with social_publish_request and record the result with social_record_post.`,
    plan.format === "video" || plan.format === "mix"
      ? `Videos: make them yourself with ${plan.videoEngine === "auto" ? "Remotion (templated) or HyperFrames (custom motion), whichever suits the idea" : plan.videoEngine} using video_render; never use stock footage you can't credit.`
      : "",
    a.method === "browser"
      ? `This account posts through your browser. Sign in with vault_fill if you are signed out (use the account id "${a.id}").`
      : `This account posts through the connected ${p.name} app (apps__ tools). If it is not connected, tell the user to connect ${p.toolkit} in Connections.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const PLATFORM_LIST = Object.keys(PLATFORMS) as Platform[];

export function slugId(platform: string, handle: string) {
  return `${platform}-${handle.replace(/^@/, "")}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

/** Make or update the autopost routine for one account, so the scheduler runs it. */
export function syncAutopost(runtime: Runtime, account: SocialAccount) {
  const rid = routineIdFor(account.id);
  // drop the routine from whoever had it before
  for (const r of runtime.store.routines()) if (r.id === rid && r.hireId !== account.hireId) runtime.store.removeRoutine(r.hireId, rid);
  if (!account.hireId) {
    runtime.emit({ type: "routines-changed" });
    return;
  }
  runtime.store.upsertRoutine({
    id: rid,
    hireId: account.hireId,
    cron: planCron(account.autopost),
    prompt: autopostPrompt(account),
    enabled: account.autopost.enabled,
    source: "autopost",
    lastRunAt: null,
  });
  // the "post without asking" choice applies to this employee's publish requests
  runtime.emit({ type: "routines-changed" });
}

export function removeAutopost(runtime: Runtime, account: SocialAccount) {
  if (account.hireId) runtime.store.removeRoutine(account.hireId, routineIdFor(account.id));
  runtime.emit({ type: "routines-changed" });
}

function accountFor(ctx: ToolContext, ref: string) {
  const a = ctx.runtime.store.socialAccount(ref) ?? ctx.runtime.store.socialAccounts().find((x) => x.handle.replace(/^@/, "").toLowerCase() === ref.replace(/^@/, "").toLowerCase());
  if (!a) throw new Error(`No social account "${ref}". Use social_accounts to see them.`);
  return a;
}

function publicAccount(runtime: Runtime, a: SocialAccount) {
  const p = PLATFORMS[a.platform];
  return {
    id: a.id,
    platform: a.platform,
    platformName: p.name,
    handle: a.handle,
    method: a.method,
    signIn:
      a.method === "browser"
        ? { loginUrl: a.loginUrl || p.loginUrl, savedLogin: runtime.vault.has(a.id), hasTwoStepCode: !!safeTotp(runtime, a.id) }
        : { composioApp: p.toolkit },
    composeUrl: p.composeUrl,
    limits: { maxChars: p.maxChars, video: p.video },
    postsFor: a.hireId ? runtime.findHire(a.hireId)?.name ?? null : null,
    autopost: a.autopost,
    recentPosts: runtime.store
      .socialPosts({ accountId: a.id, limit: 10 })
      .map((x) => ({ at: x.at, status: x.status, text: x.text.slice(0, 160), url: x.url })),
  };
}

function safeTotp(runtime: Runtime, id: string) {
  try {
    return runtime.vault.get(id)?.totpSecret ?? null;
  } catch {
    return null;
  }
}

const POSTING_WINDOW_MS = 20 * 60_000;

export const socialTools: ToolDef[] = [
  {
    name: "social_accounts",
    description:
      "List the social media accounts you can post to, with each one's sign-in method, limits, autopost plan (brief, topics, format) and recent posts (so you don't repeat yourself).",
    input: z.object({}),
    risk: "read",
    async execute(_i, ctx) {
      const all = ctx.runtime.store.socialAccounts();
      const mine = all.filter((a) => !a.hireId || a.hireId === ctx.hire.id);
      return mine.map((a) => publicAccount(ctx.runtime, a));
    },
  },
  {
    name: "social_publish_request",
    description:
      "Ask to publish one finished post to a social account. Give the exact text and any media files (paths in your files folder, e.g. media/2026-01-01-launch.mp4). The user approves it (unless the account's plan posts without asking); once allowed you have 20 minutes to sign in and publish it with your browser or the connected app. Then call social_record_post.",
    input: z.object({
      account: z.string().describe("Account id from social_accounts"),
      text: z.string().describe("The exact caption or post text"),
      media: z.array(z.string()).default([]).describe("Files to attach, relative to your files folder"),
      title: z.string().optional().describe("Video title, for YouTube or Reddit"),
    }),
    risk: "write",
    dynamicPolicy: (i: any, ctx) => {
      try {
        const a = accountFor(ctx, String(i.account));
        return a.autopost.approval === "auto" && a.hireId === ctx.hire.id ? "auto" : undefined;
      } catch {
        return undefined;
      }
    },
    summarize: (i: any) =>
      `Publish to ${i.account}: "${String(i.text).slice(0, 220)}${String(i.text).length > 220 ? "…" : ""}"${i.media?.length ? ` with ${i.media.join(", ")}` : ""}`,
    async execute(i: any, ctx) {
      const a = accountFor(ctx, String(i.account));
      const p = PLATFORMS[a.platform];
      if (i.text.length > p.maxChars) return { error: `Too long for ${p.name}: ${i.text.length} of ${p.maxChars} characters. Shorten it and ask again.` };
      const root = ctx.runtime.filesDir(ctx.hire);
      const media: string[] = [];
      for (const m of i.media ?? []) {
        const full = path.resolve(root, m);
        if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) return { error: `No file ${m} in your files folder` };
        media.push(full);
      }
      const post = ctx.runtime.store.addSocialPost({ accountId: a.id, hireId: ctx.hire.id, text: i.text, media: i.media ?? [], status: "approved" });
      ctx.runtime.openPostingWindow(ctx.hire.id, { until: Date.now() + POSTING_WINDOW_MS, account: a, text: i.text, title: i.title, media });
      return {
        approved: true,
        postId: post.id,
        account: publicAccount(ctx.runtime, a),
        mediaPaths: media,
        next:
          a.method === "browser"
            ? [
                `For 20 minutes you may publish this post on ${p.name} without further approval: clicks on that site, the approved text (typed exactly as approved) and the approved media. Anything else, or any other site, asks the user.`,
                `1. browser_navigate to ${p.composeUrl || a.loginUrl || p.loginUrl}. If you are signed out, open ${a.loginUrl || p.loginUrl}, take a browser_snapshot, then vault_fill the username, then the password (and "otp" if a code is asked) using account "${a.id}".`,
                `2. If a captcha or a check you can't pass appears, ask_user to finish it on your screen, then continue.`,
                `3. Compose the post with exactly the approved text. Upload media with browser_file_upload using these full paths: ${media.join(", ") || "(none)"}.`,
                `4. Publish, wait for it to appear, copy the post URL, then call social_record_post with postId ${post.id}.`,
              ]
            : [
                `Publish through the connected ${p.name} app: find the right action with apps__COMPOSIO_SEARCH_TOOLS (e.g. "create a ${p.name} post${media.length ? " with media" : ""}"), then run it with apps__COMPOSIO_MULTI_EXECUTE_TOOL using exactly the approved text.`,
                media.length ? `Media files are at: ${media.join(", ")}. Give the tool the full path; it uploads the file.` : "",
                `Then call social_record_post with postId ${post.id} and the URL it returns.`,
              ].filter(Boolean),
      };
    },
  },
  {
    name: "social_record_post",
    description: "Record what happened to a publish request: posted (with the post URL) or failed (with what went wrong).",
    input: z.object({
      postId: z.string(),
      status: z.enum(["posted", "failed"]),
      url: z.string().optional(),
      error: z.string().optional(),
    }),
    risk: "read",
    async execute(i, ctx) {
      const ok = ctx.runtime.store.updateSocialPost(i.postId, { status: i.status, url: i.url ?? null, error: i.error ?? null });
      ctx.runtime.closePostingWindow(ctx.hire.id);
      ctx.runtime.emit({ type: "social-changed" });
      return ok ? { recorded: true } : { error: `No post ${i.postId}` };
    },
  },
  {
    name: "vault_fill",
    description:
      "Type a saved login value into a field on your browser page without seeing it: field 'username', 'password' or 'otp' (the current two-step code). Works only on that account's own site, and passwords only go into password fields. Take a browser_snapshot first and pass the field's ref and a short description.",
    input: z.object({
      account: z.string().describe("Account id from social_accounts"),
      field: z.enum(["username", "password", "otp"]),
      ref: z.string().describe("Exact element ref from the page snapshot"),
      element: z.string().describe("Human description of the field, e.g. 'Password input'"),
      submit: z.boolean().default(false).describe("Press Enter after typing"),
    }),
    risk: "write",
    summarize: (i: any) => `type the saved ${i.field} for ${i.account} into "${i.element}"`,
    async execute(i: any, ctx) {
      const a = accountFor(ctx, String(i.account));
      if (a.hireId && a.hireId !== ctx.hire.id) return { error: "This account is assigned to another employee" };
      const cred = ctx.runtime.vault.get(a.id);
      if (!cred) return { error: `No saved login for ${a.id}. Ask the user to save it in Connections → Social accounts.` };
      let value: string;
      if (i.field === "username") value = cred.username;
      else if (i.field === "password") value = cred.password;
      else {
        if (!cred.totpSecret) return { error: "No two-step secret saved for this account. Ask the user to read you the code or add it in Connections." };
        value = totp(cred.totpSecret);
      }
      const ref = /^((?:f\d+)?)e\d+$/.exec(i.ref);
      if (!ref) return { error: "Pass the field's ref from the latest browser_snapshot, like e12 (not a selector)." };
      // The address comes from the browser, not from the page, so a page can't pretend to be another site.
      const page = await ctx.runtime.browserPage(ctx.hire);
      if (!page.url || !onAccountSite(a, page.url)) {
        return { error: `Not typed: your browser is on ${siteOf(page.url)}, which isn't ${PLATFORMS[a.platform].name}'s site for this account. Open ${a.loginUrl || PLATFORMS[a.platform].loginUrl} and try there.` };
      }
      // Only fields of the page itself: an embedded frame can belong to another site.
      if (ref[1] !== page.refPrefix) return { error: "Not typed: that field is inside an embedded frame. Use a field of the page itself, with a ref from a fresh browser_snapshot." };
      const kind = await ctx.runtime.browserFieldType(ctx.hire, i.element, i.ref);
      if (!kind || (i.field === "password" && kind !== "password")) {
        return { error: i.field === "password" ? "Not typed: that isn't a password field." : "Not typed: that isn't a text field." };
      }
      try {
        await ctx.runtime.browserCall(ctx.hire, "browser_type", { element: i.element, target: i.ref, text: value, submit: !!i.submit });
      } catch {
        return { error: "Could not type into that field. Take a fresh browser_snapshot and try again with the new ref." };
      }
      return { filled: i.field, note: "Typed without showing the value. Take a snapshot to see the page." };
    },
  },
];

function siteOf(page: string | null) {
  try {
    return new URL(page ?? "").host || "an unknown page";
  } catch {
    return "an unknown page";
  }
}

export { PLATFORM_LIST };
