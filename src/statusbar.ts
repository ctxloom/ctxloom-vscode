import * as vscode from "vscode";

/**
 * A status-bar entry point for ctxloom. P0 shows a static label that runs the
 * agent on click; the active profile name will be filled in once the backend
 * exposes it over `--json` (so the extension doesn't duplicate config-schema
 * knowledge — it stays a thin frontend).
 */
export function createStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  item.text = "$(rocket) ctxloom";
  item.tooltip = "Run the ctxloom agent";
  item.command = "ctxloom.run";
  item.show();
  return item;
}

/**
 * A status-bar entry point for the chat panel, sitting just left of the run
 * button so launching the GUI chat is one click away.
 */
export function createChatStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    99,
  );
  item.text = "$(comment-discussion) ctxloom chat";
  item.tooltip = "Open the ctxloom chat";
  item.command = "ctxloom.openChat";
  item.show();
  return item;
}
