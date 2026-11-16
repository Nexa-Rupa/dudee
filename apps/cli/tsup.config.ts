import { defineConfig } from "tsup";

// One self-contained CLI: the workspace packages (@dude/*) are bundled in from source;
// third-party libraries stay as normal npm dependencies.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  noExternal: [/^@dude\//],
  esbuildOptions(options) {
    options.conditions = ["dude-source"];
  },
});
