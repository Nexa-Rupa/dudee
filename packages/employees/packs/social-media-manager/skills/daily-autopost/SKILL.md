---
name: daily-autopost
description: Make and publish today's post for one social account end to end - angle, copy, image or video you render yourself, sign-in, publish, log.
argument-hint: "<account id>"
license: MIT
---
1. **Know the account.** Call `social_accounts`. Find the account (the argument, or the one named in the routine).
   Read its autopost plan (brief, topics, format, video engine), limits and the last 10 posts. Read what you
   remember about the brand (voice, audience, offers). If there is no brand voice yet, read the company website
   with web_fetch, describe the voice in two lines and save it with memory_save.

2. **Pick today's angle.** Rotate the plan's topics (the one least recently used). Check web_search for one fresh,
   relevant hook (a news item, a season, a common question). One post makes one point. Write the angle in one
   sentence before you write anything else.

3. **Pick the format.** Use the plan's format. For `mix`: video on Mon/Wed/Fri, image on Tue/Thu, text on the
   weekend, unless the angle clearly suits another. Instagram, TikTok and YouTube always need media (image or
   video); X, LinkedIn, Threads and Facebook can be text only.

4. **Write the copy** to the platform's limits:
   - First line is the hook and must work alone.
   - Short lines, one idea per line, concrete details. No hashtag walls: at most 3 relevant hashtags
     (0-1 on LinkedIn and X). End with a question or a clear next step.
   - Save it to `posts/<date>-<account>.md` with the angle, the copy and the media plan.

5. **Make the media.**
   - Image: `generate_image` (portrait_4_3 for Instagram/LinkedIn, square_hd for X/Facebook). Put no text in
     the image unless asked; text renders badly.
   - Video: follow the `remotion-video` skill (default; data-driven scenes, captions, voiceover) or the
     `hyperframes-video` skill (custom motion, kinetic type) - whichever the plan's engine says, or the better
     fit when it says auto. Vertical 1080x1920 for Reels, Shorts and TikTok; 15-45 seconds; the hook on screen
     in the first second; captions always on (most people watch muted).
   - Check the render: the file exists under media/ and its length fits the platform.

6. **Publish.** Call `social_publish_request` with the account id, the exact text and the media paths.
   - If it is declined, stop: save the draft and say it is ready for later.
   - The approval covers that account's site, the exact text and title, and those files. Type the text exactly as
     approved; anything else asks the user again.
   - If approved, follow the `next` steps it returns. For browser accounts read
     `references/platform-playbooks.md` for that platform's flow.
   - Sign in with `vault_fill` (username, then password, then `otp` if a code is asked). Take a
     `browser_snapshot` before each fill to get the field's ref.

7. **Log it.** Call `social_record_post` with the post id and the live post URL (open the profile to find it if
   the site doesn't show it), or status failed with the reason.

8. **Report** in two lines: what you posted, where (URL), and what you'll try tomorrow.
