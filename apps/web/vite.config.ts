import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, run `dude ui --port 4777` (with DUDE_UI_TOKEN set) and `pnpm --filter @dude/web dev`.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:4777", changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
