import * as vscode from "vscode";
import { exec, workspaceDir } from "./cli";

// Shown (as a toast) when ctxloom's project root falls back to the workspace
// folder itself — no CTXLOOM_ROOT override and not inside a git repository — so
// tasks, plans, and sessions are keyed to this exact path under ~/.ctxloom
// rather than a stable repo root. The "ctxloom:" prefix matches the backend's
// `ctxloom: warning: …` voice; the wording mirrors `ctxloom run`'s own warning.
const ROOT_FALLBACK_WARNING =
  "Not in a Git repository — this folder is itself the project root, so its " +
  "sessions, plans, and tasks are keyed to this exact path under ~/.ctxloom. " +
  "Re-open from a repo root (or set CTXLOOM_ROOT) to keep them stable.";

interface RawStatus {
  root_fallback?: unknown;
}

/**
 * Recomputes the `ctxloom.rootFallback` context key that gates the amber warning
 * button in the Sessions / Plans / Tasks title bars. The fallback state is read
 * from the backend's `manage status --format json` (projectroot.RootFromFallback)
 * — the single source of truth, shared with `ctxloom run`, so the extension never
 * re-derives "is this a project root" with its own filesystem checks. Best-effort:
 * no folder open, or a failed query, clears the warning rather than guessing.
 */
async function updateRootWarning(): Promise<void> {
  let fallback = false;
  if (workspaceDir() !== undefined) {
    try {
      const { stdout } = await exec(["manage", "status", "--format", "json"]);
      const raw: RawStatus = JSON.parse(stdout);
      fallback = raw.root_fallback === true;
    } catch {
      fallback = false;
    }
  }
  void vscode.commands.executeCommand("setContext", "ctxloom.rootFallback", fallback);
}

/**
 * Registers the shared project-root-fallback warning used by all three top-level
 * views: the `ctxloom.gitWarning` command (a toast with the full explanation)
 * plus the context-key computation, kept fresh as the workspace folders change.
 * The views stay decoupled — they only contribute the amber title-bar button,
 * gated on the `ctxloom.rootFallback` context key.
 */
export function registerGitWarning(context: vscode.ExtensionContext): void {
  void updateRootWarning();
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.gitWarning", () => {
      void vscode.window.showWarningMessage(`ctxloom: ${ROOT_FALLBACK_WARNING}`);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void updateRootWarning()),
  );
}
