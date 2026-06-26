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
