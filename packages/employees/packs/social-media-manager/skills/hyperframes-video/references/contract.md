# HyperFrames composition rules

HyperFrames renders HTML to video by pausing a GSAP timeline and seeking it frame by frame, so the same file always
renders the same video. Docs: https://hyperframes.heygen.com

## Structure

```html
<div id="root" data-composition-id="main" data-start="0" data-duration="15" data-width="1080" data-height="1920">
  <section id="s1" class="clip" data-start="0"   data-duration="4"  data-track-index="0"> … </section>
  <section id="s2" class="clip" data-start="4"   data-duration="6"  data-track-index="0"> … </section>
  <section id="s3" class="clip" data-start="10"  data-duration="5"  data-track-index="0"> … </section>
  <audio id="music" class="clip" src="assets/music.mp3" data-start="0" data-duration="15" data-volume="0.4"></audio>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.from("#s1 h1", { y: 80, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.1);
  tl.from("#s2 li", { x: -60, opacity: 0, stagger: 0.25, duration: 0.5 }, 4.2);
  window.__timelines["main"] = tl;
  tl.seek(0);
</script>
```

## Rules

1. Every timed element has `class="clip"`, `data-start` and `data-duration` (seconds). It shows over
   `[start, start + duration)`. Clips that never overlap can share a `data-track-index`; stacking order is `z-index`.
2. The video's length is the root's `data-duration`.
3. Build one paused timeline and register it: `window.__timelines["<data-composition-id>"] = tl`. Place tweens at
   absolute times (the last argument) that fall inside their clip's window.
4. No `Date.now()`, no unseeded `Math.random()`, no network fetches, no `setTimeout`/`setInterval`, no
   `repeat: -1`. Everything visible must be a function of timeline time.
5. Never tween `display`, `visibility` or `autoAlpha` on a `.clip`; animate a child element instead.
6. Don't put a CSS `transform` on an element GSAP transforms; animate `x`, `y`, `scale`, `rotation`, not
   `left`/`top`/`width`/`height`.
7. Never `play()`, `pause()` or seek media yourself. A `<video>` is `muted` unless it has `data-has-audio="true"`.
   Music and voice are separate `<audio>` elements, each with an `id`.
8. Asset paths are relative: `assets/...` (no leading `/`).
9. Use web-safe or bundled fonts (sans-serif, serif, monospace) unless you add an `@font-face` to a file in
   `assets/fonts/`.
10. Keep text inside the middle 80% of the frame (platform buttons cover the edges on vertical video).

## Good social patterns

- Kinetic headline: split the hook into words (`<span>` each) and stagger them in, 0.06 s apart.
- Big number: count a number up by tweening an object and writing it in `onUpdate` (allowed: driven by the timeline).
- Progress bar along the bottom for the whole duration keeps people watching.
- End card with the handle and one call to action for the last 2-3 seconds.
