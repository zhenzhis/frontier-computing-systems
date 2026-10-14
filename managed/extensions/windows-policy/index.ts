import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// The pinned package root exports service accessors, not the extension factory.
// npm ci installs this package-local dependency; use its Pi extension entry.
import permissionSystem from "../../../node_modules/@gotgenes/pi-permission-system/src/index.ts";

const parserPath = join(dirname(fileURLToPath(import.meta.url)), "normalize-command.ps1");

async function normalizePowerShell(command: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.env.PWSH_PATH || "pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", parserPath], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"], signal, timeout: 10000,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > 1000000) child.kill();
    });
    child.stderr.resume();
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", code => {
      if (code !== 0) return reject(new Error("PowerShell command parsing failed; command was not executed."));
      try {
        const parsed = JSON.parse(stdout);
        if (typeof parsed.command !== "string") throw new Error("Invalid parser result");
        resolveResult(parsed.command);
      } catch { reject(new Error("Invalid PowerShell parser response; command was not executed.")); }
    });
    child.stdin.end(JSON.stringify({ command }));
  });
}

export default function windowsPolicy(pi: ExtensionAPI) {
  // Pi explicitly supports mutating tool arguments before later permission handlers.
  // Register the compatibility hook and upstream gates in one factory to fix ordering.
  pi.on("tool_call", async (event, ctx) => {
    const input = event.input as Record<string, unknown>;
    if (event.toolName === "powershell" && typeof input.command === "string") {
      try { input.command = await normalizePowerShell(input.command, ctx.signal); }
      catch (error) { return { block: true, reason: String(error) }; }
    }
    if (event.toolName !== "mcp" && !event.toolName.startsWith("mcp__")) return;
    const isProxyCall = event.toolName === "mcp";
    if (isProxyCall && typeof input.tool !== "string") return;
    let args = isProxyCall ? input.args ?? {} : input;
    if (typeof args === "string") {
      try { args = JSON.parse(args); }
      catch { return { block: true, reason: "MCP arguments must be valid JSON." }; }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) return { block: true, reason: "MCP arguments must be an object." };
    const values = args as Record<string, unknown>;
    if (isProxyCall) {
      input.args = values;
      input.arguments = values;
    }
    if (typeof values.path === "string") {
      const expanded = values.path.replace(/^~(?=[\\/]|$)/, homedir());
      try {
        if ((await stat(resolve(ctx.cwd, expanded))).isDirectory()) return {
          block: true,
          reason: "Index individual files or already-read content. Recursive MCP indexing cannot apply Pi's per-file permission rules.",
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { block: true, reason: "Cannot verify the MCP indexing path." };
      }
    }
  });
  permissionSystem(pi);
}
