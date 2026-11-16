import path from "node:path";
import { fileURLToPath } from "node:url";

/** Folder with the built web app, served by `dude ui`. */
export const webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
