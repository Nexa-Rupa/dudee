---
name: remotion-video
description: Make a short social video with Remotion by writing a JSON video spec (scenes, captions, voiceover, music) and rendering it to MP4 with video_render. Best for daily, templated videos.
argument-hint: "<what the video is about>"
license: MIT
---
1. **Script first.** Write the beats: a hook (1-2 s), 2-4 points (3-5 s each), a call to action (2-3 s).
   15-45 seconds total. One idea per scene, at most ~12 words on screen per scene.

2. **Voiceover (optional, recommended for explainers).** Write the spoken lines, then `generate_voiceover`.
   It returns `estimatedSeconds`; make the scene durations add up to about that.

3. **Media.** Generate any images you need with `generate_image` (portrait_16_9 for vertical video). Every file a
   spec uses must be in your files folder (e.g. `media/2026-01-05-hero.png`); web URLs work too.

4. **Write the spec** to `videos/<date>-<slug>.json` with files_write. Read `references/spec.md` for every field
   and two full examples. Vertical (1080x1920) for Reels, Shorts and TikTok; 1080x1080 for feeds; 1920x1080 for
   YouTube and LinkedIn landscape.
   - Add `captions` that match the voiceover (or the on-screen points), each 1-3 seconds.
   - Use the brand's colours in `theme` (from memory, or the website).

5. **Render** with `video_render` engine `remotion`, source the spec path. The first render installs Remotion,
   which takes a few minutes; later renders take under a minute for a short video.
   If it fails, read the error, fix the spec (a missing file, a bad scene type) and render again.

6. Report the file under media/ and its length.
