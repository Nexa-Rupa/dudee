---
name: post-visuals
description: Create on-brand images for posts (carousel covers, blog headers, thumbnails) with generate_image, or short video clips with fal_run.
argument-hint: "<what the visual is for>"
license: MIT
---
1. Decide the format: blog header (landscape_16_9), carousel or feed post (square_hd), story or Reel cover (portrait_16_9).
2. Write the prompt as a photographer or designer would brief it: subject, setting, composition, lighting, colors from the brand voice in memory, style (photo, flat illustration, 3D). Avoid text inside the image unless you use a model good at text (fal-ai/ideogram/v3 or fal-ai/recraft-v3).
3. Generate 2 options with generate_image (num_images: 2). Generating costs money, so the user approves it.
4. For a short video clip, use fal_run with a text-to-video model (for example fal-ai/kling-video/v2.1/standard/text-to-video with { prompt, duration: "5" }). Video takes a few minutes.
5. Say which file you recommend and why. Files are saved under media/.
