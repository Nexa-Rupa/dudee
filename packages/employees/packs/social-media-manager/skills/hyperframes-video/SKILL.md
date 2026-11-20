---
name: hyperframes-video
description: Make a custom motion-design video with HyperFrames (HTML + GSAP rendered frame by frame to MP4) - kinetic type, animated charts, branded title cards. Use when a templated Remotion spec can't express the idea.
argument-hint: "<what the video is about>"
license: MIT
---
1. **Plan the beats** in one short list: what is on screen and when, in seconds. 10-30 s for social.
   Vertical 1080x1920 unless the platform wants otherwise.

2. **Start the project** with `video_new_hyperframes` (name, format, seconds, title). It writes
   `videos/<name>/index.html` and an `assets/` folder. To use an image, video or MP3 you made (under media/),
   reference it as `assets/<file name>`: video_render copies it from media/ into the project before rendering.
   Pure HTML/CSS/SVG visuals render fastest.

3. **Write the composition** with files_write, replacing index.html. Read `references/contract.md` and follow every
   rule; the most common mistakes are missing `class="clip"` / `data-start` / `data-duration` on timed elements,
   forgetting `window.__timelines["main"] = tl`, and using timers or `Math.random()`.

4. **Render** with `video_render` engine `hyperframes`, source `videos/<name>`. It runs HyperFrames' own check first;
   if it reports errors, fix each one and render again. HyperFrames needs FFmpeg on this computer; if the tool
   says it is missing, tell the user, or switch to the remotion-video skill.

5. Report the file under media/ and its length.
