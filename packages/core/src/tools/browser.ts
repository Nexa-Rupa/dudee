import path from "node:path";
import type { McpServerConfig, Policy } from "../types.js";

/**
 * A real browser per employee, driven through Playwright MCP. Each employee gets its own
 * persistent profile (cookies, logins) under .dude/team/<id>/browser, and the window is
 * visible on your machine so you can watch or take over. After each browser step the
 * runtime grabs a screenshot for the web app's Screen panel.
 */
export const PLAYWRIGHT_MCP = "@playwright/mcp@0.0.84";

export function browserServer(hireDirPath: string): McpServerConfig {
  const args = [
    "-y",
    PLAYWRIGHT_MCP,
    "--user-data-dir",
    path.join(hireDirPath, "browser"),
    "--output-dir",
    path.join(hireDirPath, "browser-output"),
    "--viewport-size",
    "1280x800",
  ];
  if (process.env.DUDE_BROWSER_HEADLESS === "1") args.push("--headless");
  if (process.env.DUDE_BROWSER) args.push("--browser", process.env.DUDE_BROWSER);
  return { command: process.platform === "win32" ? "npx.cmd" : "npx", args };
}

/** Looking around runs at once; anything that can submit, post or buy asks; raw code is off. */
const BROWSER_POLICY: Record<string, Policy> = {
  browser_navigate: "auto",
  browser_navigate_back: "auto",
  browser_wait_for: "auto",
  browser_tabs: "auto",
  browser_hover: "auto",
  browser_resize: "auto",
  browser_press_key: "ask",
  browser_click: "ask",
  browser_type: "ask",
  browser_fill_form: "ask",
  browser_select_option: "ask",
  browser_file_upload: "ask",
  browser_drag: "ask",
  browser_drop: "ask",
  browser_handle_dialog: "ask",
  browser_evaluate: "deny",
  browser_run_code_unsafe: "deny",
};

export function browserPolicy(tool: string): Policy | undefined {
  return BROWSER_POLICY[tool];
}

/** Steps that change what is on screen, after which a fresh screenshot is worth taking. */
export function changesScreen(tool: string) {
  return tool.startsWith("browser_") && !["browser_take_screenshot", "browser_snapshot", "browser_close"].includes(tool) &&
    !tool.includes("cookie") && !tool.includes("localstorage") && !tool.includes("network") && !tool.includes("console");
}
