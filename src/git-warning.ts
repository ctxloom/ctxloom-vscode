import { existsSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import { workspaceDir } from "./cli";

// The full explanation, shown as a toast when the title-bar warning is clicked.
// ctxloom keys a project on its Git root, so a workspace opened on a sub-folder
// (or a non-Git folder) can surface a parent project's data or none. The
// "ctxloom:" prefix matches the backend's `ctxloom: warning: …` voice.
const GIT_ROOT_WARNING =
  "This folder isn't a Git repository root — sessions, plans, and tasks are " +
  "scoped to the project (Git) root, so the ones shown here may be empty or " +
  "belong to a parent project.";

/** True when `dir` is a Git working-tree root (a linked worktree's .git is a file). */
function isGitRoot(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

/**
 * Recomputes the `ctxloom.notGitRoot` context key that gates the amber warning
 * button in the Sessions, Plans, and Tasks title bars. False (no warning) when no
 * folder is open — the empty-state is handled elsewhere.
 */
function updateGitRootWarning(): void {
  const dir = workspaceDir();
  const notGitRoot = dir !== undefined && !isGitRoot(dir);
  void vscode.commands.executeCommand("setContext", "ctxloom.notGitRoot", notGitRoot);
}

/**
 * Registers the shared not-a-Git-root warning used by all three top-level views:
 * the `ctxloom.gitWarning` command (a toast with the full explanation) plus the
 * context-key computation, kept fresh as the workspace folders change. The views
 * themselves stay decoupled — they only contribute the amber title-bar button,
 * gated on the `ctxloom.notGitRoot` context key.
 */
export function registerGitWarning(context: vscode.ExtensionContext): void {
  updateGitRootWarning();
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.gitWarning", () => {
      void vscode.window.showWarningMessage(`ctxloom: ${GIT_ROOT_WARNING}`);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateGitRootWarning()),
  );
}
