# Remotion video spec

A JSON file. `video_render` (engine `remotion`) renders it with the built-in "Scenes" composition.
File paths are relative to your files folder.

| Field | Type | Notes |
|---|---|---|
| `width`, `height` | number | 1080x1920 vertical (default), 1080x1080 square, 1920x1080 landscape |
| `fps` | number | 30 (default) |
| `theme` | object | `background`, `foreground`, `accent` (CSS colours), `font` (CSS font-family) |
| `transition` | string | `fade` (default), `slide`, `zoom`, `none` |
| `scenes` | array | required, in order; see below |
| `captions` | array | `{ "text", "start", "end" }` in seconds from the start of the video |
| `voiceover` | string | an MP3 from generate_voiceover |
| `music` | string | an MP3 you are allowed to use; `musicVolume` 0-1 (auto-ducked to 0.15 under a voiceover) |
| `watermark` | string | small text in the top corner, e.g. the handle |

## Scenes

Every scene has `type` and `duration` (seconds). Optional `background` and `color` override the theme.

| type | fields |
|---|---|
| `title` | `heading`, `text` (subtitle) |
| `text` | `heading`, `text` |
| `bullets` | `heading`, `bullets` (array of short strings, they animate in one by one) |
| `image` | `image` (path or URL, slow zoom), optional `heading`, `text` overlaid at the bottom |
| `video` | `video` (MP4 path or URL, muted), optional `heading`, `text` |
| `quote` | `text`, `author` |
| `stat` | `value` (big, e.g. "3x"), `label`, `text` |
| `cta` | `heading`, `text` (shown as a button, e.g. "Link in bio") |

## Example: 20-second vertical tip with voiceover

```json
{
  "width": 1080, "height": 1920, "fps": 30,
  "theme": { "background": "#0f172a", "foreground": "#ffffff", "accent": "#22d3ee", "font": "Inter, Arial, sans-serif" },
  "transition": "slide",
  "voiceover": "media/2026-01-05-tip-vo.mp3",
  "watermark": "@acme",
  "scenes": [
    { "type": "title", "duration": 2.5, "heading": "Stop losing leads at night", "text": "3 fixes in 20 seconds" },
    { "type": "bullets", "duration": 9, "heading": "Do this", "bullets": ["Auto-reply in under 1 minute", "Offer two booking times", "Follow up next morning"] },
    { "type": "stat", "duration": 4, "value": "78%", "label": "buy from the first business to reply", "text": "Source: Lead Connect survey" },
    { "type": "cta", "duration": 4.5, "heading": "Want the template?", "text": "Comment TEMPLATE" }
  ],
  "captions": [
    { "text": "Losing leads at night?", "start": 0, "end": 2.5 },
    { "text": "Reply in under a minute", "start": 2.5, "end": 5.5 },
    { "text": "Offer two times to book", "start": 5.5, "end": 8.5 },
    { "text": "Follow up the next morning", "start": 8.5, "end": 11.5 },
    { "text": "78% buy from whoever replies first", "start": 11.5, "end": 15.5 },
    { "text": "Comment TEMPLATE", "start": 15.5, "end": 20 }
  ]
}
```

## Example: 12-second square product teaser with images

```json
{
  "width": 1080, "height": 1080,
  "theme": { "background": "#111111", "accent": "#f2b33d" },
  "scenes": [
    { "type": "image", "duration": 4, "image": "media/2026-01-06-product.png", "heading": "Meet Nova", "text": "Our lightest bottle yet" },
    { "type": "quote", "duration": 4, "text": "I carry it everywhere.", "author": "Priya, customer" },
    { "type": "cta", "duration": 4, "heading": "Out now", "text": "Shop the link in bio" }
  ]
}
```

Only quote real customers whose words you have. Only use stats you can source, and name the source on screen.
