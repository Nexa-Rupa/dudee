import path from "node:path";
import { fileURLToPath } from "node:url";

/** Folder holding the built-in employee packs (works from src/ and dist/). */
export const packsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "packs");
