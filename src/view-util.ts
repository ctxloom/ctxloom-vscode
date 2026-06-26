import * as vscode from "vscode";

/**
 * Narrows a possibly-undefined command argument to a present item. Tree-item
 * commands receive the selected item when run from a view, but VS Code can
 * invoke a command with no argument (Command Palette, a keybinding, a stale menu
 * context). Guarding with this turns that into a friendly nudge instead of a
 * "Cannot read properties of undefined" crash.
 */
export function requireItem<T>(item: T | undefined): item is T {
  if (item === undefined || item === null) {
    void vscode.window.showInformationMessage(
      "ctxloom: run this action from an item in the ctxloom views.",
    );
    return false;
  }
  return true;
}

/**
 * A concise message from a failed CLI exec. A child_process rejection wraps the
 * whole command line plus stderr in `message`; the backend's own error rides
 * `stderr`, so we prefer its last non-empty line (e.g. "Error: distillation
 * failed: …") over the noisy wrapper. Falls back to the raw string otherwise.
 */
export function cliError(err: unknown): string {
  if (err !== null && typeof err === "object" && "stderr" in err) {
    const last = String((err as { stderr: unknown }).stderr)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .at(-1);
    if (last !== undefined) {
      return last;
    }
  }
  return String(err);
}
