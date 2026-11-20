/**
 * Files for the shared Remotion studio (`.dude/studio/remotion`). It renders any video spec
 * (a JSON file of scenes) the employee writes, so daily videos need no code, only data.
 */
export const REMOTION_VERSION = "4.0.545";
export const HYPERFRAMES_VERSION = "0.9.72";

export const REMOTION_PACKAGE = JSON.stringify(
  {
    name: "dudee-remotion-studio",
    private: true,
    type: "module",
    dependencies: {
      remotion: REMOTION_VERSION,
      "@remotion/cli": REMOTION_VERSION,
      react: "18.3.1",
      "react-dom": "18.3.1",
    },
  },
  null,
  2
);

export const REMOTION_INDEX = `import { registerRoot } from "remotion";
import { Root } from "./Root";
registerRoot(Root);
`;

export const REMOTION_ROOT = `import React from "react";
import { Composition } from "remotion";
import { Scenes, totalFrames, type Spec } from "./Scenes";

const fallback: Spec = {
  width: 1080,
  height: 1920,
  fps: 30,
  scenes: [{ type: "title", duration: 3, heading: "Hello from dudee" }],
};

export const Root: React.FC = () => (
  <Composition
    id="Scenes"
    component={Scenes as any}
    defaultProps={fallback as any}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={90}
    calculateMetadata={({ props }: { props: any }) => {
      const spec = props as Spec;
      const fps = spec.fps ?? 30;
      return { width: spec.width ?? 1080, height: spec.height ?? 1920, fps, durationInFrames: totalFrames(spec) };
    }}
  />
);
`;

export const REMOTION_SCENES = `import React from "react";
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";

export type Scene = {
  type: "title" | "text" | "bullets" | "image" | "video" | "quote" | "stat" | "cta";
  duration: number;
  heading?: string;
  text?: string;
  bullets?: string[];
  image?: string;
  video?: string;
  author?: string;
  value?: string;
  label?: string;
  background?: string;
  color?: string;
};

export type Spec = {
  width?: number;
  height?: number;
  fps?: number;
  theme?: { background?: string; foreground?: string; accent?: string; font?: string };
  transition?: "fade" | "slide" | "zoom" | "none";
  music?: string;
  musicVolume?: number;
  voiceover?: string;
  captions?: Array<{ text: string; start: number; end: number }>;
  watermark?: string;
  scenes: Scene[];
};

const src = (p?: string) => (!p ? undefined : /^(https?:|data:)/.test(p) ? p : staticFile(p.replace(/^\\/+/, "")));

export const totalFrames = (spec: Spec) =>
  Math.max(1, Math.round((spec.scenes ?? []).reduce((s, x) => s + (Number(x.duration) || 3), 0) * (spec.fps ?? 30)));

const Enter: React.FC<{ children: React.ReactNode; mode: Spec["transition"]; frames: number }> = ({ children, mode, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.min(18, frames) });
  const out = interpolate(frame, [frames - 8, frames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const style: React.CSSProperties =
    mode === "none" ? {} :
    mode === "slide" ? { transform: \`translateY(\${(1 - t) * 80}px)\`, opacity: Math.min(t, out) } :
    mode === "zoom" ? { transform: \`scale(\${0.9 + 0.1 * t})\`, opacity: Math.min(t, out) } :
    { opacity: Math.min(t, out) };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

const Pop: React.FC<{ i: number; children: React.ReactNode }> = ({ i, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - 6 - i * 8, fps, config: { damping: 180 } });
  return <div style={{ opacity: t, transform: \`translateX(\${(1 - t) * 40}px)\` }}>{children}</div>;
};

const SceneView: React.FC<{ s: Scene; spec: Spec; frames: number }> = ({ s, spec, frames }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const theme = spec.theme ?? {};
  const fg = s.color ?? theme.foreground ?? "#ffffff";
  const accent = theme.accent ?? "#f2b33d";
  const unit = Math.min(width, height) / 1080;
  const pad = 90 * unit;
  const base: React.CSSProperties = {
    background: s.background ?? theme.background ?? "#101114",
    color: fg,
    fontFamily: theme.font ?? "Inter, Helvetica, Arial, sans-serif",
    padding: pad,
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
  };
  const h = { fontSize: 96 * unit, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 * unit, margin: 0 };
  const p = { fontSize: 46 * unit, lineHeight: 1.3, opacity: 0.9, marginTop: 30 * unit };
  const kenBurns = interpolate(frame, [0, frames], [1, 1.12]);
  switch (s.type) {
    case "image":
    case "video":
      return (
        <AbsoluteFill style={{ ...base, padding: 0 }}>
          {s.type === "image" && s.image ? (
            <Img src={src(s.image)!} style={{ width: "100%", height: "100%", objectFit: "cover", transform: \`scale(\${kenBurns})\` }} />
          ) : s.video ? (
            <OffthreadVideo src={src(s.video)!} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : null}
          {(s.heading || s.text) && (
            <AbsoluteFill style={{ justifyContent: "flex-end", padding: pad, background: "linear-gradient(transparent 45%, rgba(0,0,0,.75))" }}>
              {s.heading && <h1 style={{ ...h, fontSize: 80 * unit, textAlign: "left" }}>{s.heading}</h1>}
              {s.text && <p style={{ ...p, textAlign: "left" }}>{s.text}</p>}
            </AbsoluteFill>
          )}
        </AbsoluteFill>
      );
    case "bullets":
      return (
        <AbsoluteFill style={{ ...base, alignItems: "flex-start", textAlign: "left" }}>
          {s.heading && <h1 style={{ ...h, fontSize: 84 * unit, marginBottom: 40 * unit }}>{s.heading}</h1>}
          {(s.bullets ?? []).map((b, i) => (
            <Pop key={i} i={i}>
              <p style={{ ...p, marginTop: 18 * unit, opacity: 1 }}>
                <span style={{ color: accent, fontWeight: 800 }}>{i + 1}. </span>
                {b}
              </p>
            </Pop>
          ))}
        </AbsoluteFill>
      );
    case "quote":
      return (
        <AbsoluteFill style={base}>
          <div style={{ fontSize: 220 * unit, color: accent, lineHeight: 0.6 }}>“</div>
          <h1 style={{ ...h, fontSize: 72 * unit, fontWeight: 700 }}>{s.text}</h1>
          {s.author && <p style={{ ...p, color: accent }}>— {s.author}</p>}
        </AbsoluteFill>
      );
    case "stat":
      return (
        <AbsoluteFill style={base}>
          <h1 style={{ ...h, fontSize: 220 * unit, color: accent }}>{s.value}</h1>
          {s.label && <p style={{ ...p, fontSize: 54 * unit }}>{s.label}</p>}
          {s.text && <p style={p}>{s.text}</p>}
        </AbsoluteFill>
      );
    case "cta":
      return (
        <AbsoluteFill style={base}>
          {s.heading && <h1 style={h}>{s.heading}</h1>}
          {s.text && (
            <div style={{ marginTop: 50 * unit, background: accent, color: "#111", borderRadius: 999, padding: \`\${24 * unit}px \${56 * unit}px\`, fontSize: 48 * unit, fontWeight: 800 }}>
              {s.text}
            </div>
          )}
        </AbsoluteFill>
      );
    case "title":
    case "text":
    default:
      return (
        <AbsoluteFill style={base}>
          {s.heading && <h1 style={s.type === "title" ? { ...h, fontSize: 120 * unit } : h}>{s.heading}</h1>}
          {s.text && <p style={p}>{s.text}</p>}
          {s.type === "title" && <div style={{ width: 140 * unit, height: 10 * unit, background: accent, marginTop: 40 * unit, borderRadius: 5 }} />}
        </AbsoluteFill>
      );
  }
};

const Captions: React.FC<{ spec: Spec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  const cue = (spec.captions ?? []).find((c) => t >= c.start && t < c.end);
  if (!cue) return null;
  const unit = Math.min(width, height) / 1080;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.14 }}>
      <div style={{ background: "rgba(0,0,0,.7)", color: "#fff", fontSize: 50 * unit, fontWeight: 700, padding: \`\${14 * unit}px \${28 * unit}px\`, borderRadius: 16 * unit, maxWidth: "85%", textAlign: "center", fontFamily: spec.theme?.font ?? "Inter, Helvetica, Arial, sans-serif" }}>
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

export const Scenes: React.FC<Spec> = (spec) => {
  const { fps } = useVideoConfig();
  let at = 0;
  return (
    <AbsoluteFill style={{ background: spec.theme?.background ?? "#101114" }}>
      {(spec.scenes ?? []).map((s, i) => {
        const frames = Math.max(1, Math.round((Number(s.duration) || 3) * fps));
        const from = at;
        at += frames;
        return (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <Enter mode={spec.transition ?? "fade"} frames={frames}>
              <SceneView s={s} spec={spec} frames={frames} />
            </Enter>
          </Sequence>
        );
      })}
      <Captions spec={spec} />
      {spec.watermark && (
        <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "flex-end", padding: 40, color: "rgba(255,255,255,.75)", fontSize: 30, fontFamily: "Inter, Arial, sans-serif" }}>
          {spec.watermark}
        </AbsoluteFill>
      )}
      {spec.music && <Audio src={src(spec.music)!} volume={spec.musicVolume ?? (spec.voiceover ? 0.15 : 0.5)} />}
      {spec.voiceover && <Audio src={src(spec.voiceover)!} />}
    </AbsoluteFill>
  );
};
`;

export function hyperframesStarter(opts: { width: number; height: number; duration: number; title: string }) {
  const { width, height, duration } = opts;
  const title = opts.title.replace(/[<>&"]/g, "");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      :root { --ground: #101114; --ink: #ffffff; --accent: #f2b33d; --font-display: sans-serif; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: var(--ground); }
      #root { width: 100%; height: 100%; position: relative; font-family: var(--font-display); color: var(--ink); }
      .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 8%; }
      #title { font-size: ${Math.round(Math.min(width, height) / 9)}px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; }
      #bar { width: 12%; height: 1.2%; background: var(--accent); margin-top: 4%; border-radius: 99px; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
      <div id="scene1" class="clip center" data-start="0" data-duration="${duration}" data-track-index="0">
        <h1 id="title">${title}</h1>
        <div id="bar"></div>
      </div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.from("#title", { y: 60, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.2);
      tl.from("#bar", { scaleX: 0, transformOrigin: "left", duration: 0.5, ease: "power2.out" }, 0.6);
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}
