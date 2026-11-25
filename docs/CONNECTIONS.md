# Connections and daily autopost

Everything here is under **Connections** in the web app. Keys and logins stay on your computer.

## Social accounts and daily autopost

1. Hire a **Social Media Manager** (Maya by default). She has the `social`, `video`, `media` and `browser` tools.
2. **Connections → Add a social account**: platform, handle, who posts, and how she signs in:
   - **Your username and password.** Saved encrypted in `.dude/vault.json`. Maya signs in with her own browser
     using `vault_fill`, which types the value into the page without the model ever seeing it. Add the two-step
     secret (the base32 key shown when you set up an authenticator app) and she can type the current code too.
     Her browser keeps the session, so she signs in again only when the site asks.
   - **Connected app over OAuth.** Connect the platform under **Apps** first (Composio). No password is stored;
     she posts through the app's API tools.
3. **Daily autopost**: the time, the days, the format (text, image, video or a mix), the video engine, a brief
   (audience, voice, offers, what never to say), topics to rotate, and whether to **Ask me first** or **Post
   without asking**.

Each plan becomes a routine on the poster (`autopost-<account>`). At the time it runs her `daily-autopost` skill:

```text
social_accounts          read the plan, limits and the last 10 posts (no repeats)
web_search               one fresh hook for today
generate_image           an image, or
generate_voiceover       a voiceover, then
video_render             a video she builds herself (Remotion spec or HyperFrames HTML)
social_publish_request   one approval card with the exact text and files (skipped when "post without asking")
vault_fill + browser_*   sign in and publish (no further prompts for 20 minutes, only for this post on this site)
social_record_post       the live URL, shown under Recent posts
```

What an approved post covers: steps on that account's own site, typing the approved text or title, uploading the
approved files, or posting them through that account's connected app. Anything else asks again. `vault_fill` types a
login only on the account's own https site, and a password only into a password field of the page itself.

**Post now** on an account runs today's post at once. Approval cards also go to Telegram if it is paired, so you can
approve from your phone.

Things to know:

- Sites change and some fight automation. When a captcha or a new-device check appears, Maya asks you to finish it on
  her **Screen**. If a site warns about automated activity, she stops for the day and records why. Where a platform
  offers OAuth (X, LinkedIn, Instagram business, Facebook Pages, YouTube, TikTok, Pinterest), the connected-app route is
  more reliable than the browser.
- Instagram and TikTok posting through their APIs needs a business or creator account.
- "Post without asking" also lets her make images, voiceovers and videos without a card, for that employee.
  Take it back in her **About** tab.

## Videos

Employees render MP4s on this computer and save them under `files/media/`.

| Engine | How | Needs |
|---|---|---|
| **Remotion** | The employee writes a JSON spec (scenes: `title`, `text`, `bullets`, `image`, `video`, `quote`, `stat`, `cta`; theme, captions, music, voiceover). A shared studio in `.dude/studio/remotion` renders it. | Node; the first render installs Remotion (a few minutes, a few hundred MB) |
| **HyperFrames** | The employee writes an HTML + GSAP composition (`video_new_hyperframes` makes a starter), `video_render` runs HyperFrames' check, then renders. | FFmpeg on your PATH |

Voiceovers use ElevenLabs (`ELEVENLABS_API_KEY`) or OpenAI text-to-speech (`OPENAI_API_KEY`).

The spec format is in `packages/employees/packs/social-media-manager/skills/remotion-video/references/spec.md`.
To try a render without a model: `npx tsx --conditions=dude-source packages/core/test/render.smoke.ts`.

## Apps (Composio)

1. Get a project key (starts with `ak_`) at [dashboard.composio.dev](https://dashboard.composio.dev) → your project →
   Settings → API keys, and save it under **Apps**.
2. Click **Connect** on an app and finish the sign-in in the new tab.

dudee keeps one Composio user and one Tool Router Session for the workspace (`.dude/composio.json`). Its MCP endpoint
appears to every employee as `apps__*` tools. Looking up tools runs at once; running one asks first, like any other
action. To limit apps to some employees, set `composioHires: [Maya]` in `.dude/config.yaml`.

## Telegram

1. In Telegram message **@BotFather**, send `/newbot`, copy the token, save it under **Telegram**.
2. Message your bot. It replies with a code; approve it in Connections.

Then:

- `Maya: post a behind-the-scenes clip today` talks to Maya; a message without a name goes to the default employee
  (or the last one you talked to). `/team` lists everyone, `/pending` resends waiting approvals, `/stop Maya` stops her task.
- Approval cards arrive with **Allow / Always allow / Don't allow** buttons.
- An employee's question arrives as a message; reply to it to answer.
- What routines and daily posts did is sent to you (turn off with "Send me what routines and daily posts did").

The bridge uses long polling, so it works without a public address. Only paired chats can talk to your team.

## App servers (MCP)

Paste a URL (Streamable HTTP) or a command (`npx -y @modelcontextprotocol/server-github`), add headers or environment
lines (`Authorization=Bearer …`, `GITHUB_PERSONAL_ACCESS_TOKEN=…`), **Test**, then **Add**. dudee connects once to
check it answers before saving it to `.dude/config.yaml`.
