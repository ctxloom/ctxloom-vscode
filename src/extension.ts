import * as vscode from "vscode";
import { ChatSession } from "./chat";
import { checkCompanions, checkCompanionsOnStartup } from "./companions";
import { runAgent } from "./run";
import { createStatusBar } from "./statusbar";

/**
 * Activates the ctxloom companion: registers commands, shows the status bar, and
 * runs a best-effort companion probe. Following ctxloom's fault-tolerance
 * philosophy, startup never blocks on a failing feature — each is best-effort.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.run", runAgent),
    vscode.commands.registerCommand("ctxloom.openChat", () =>
      ChatSession.open(context),
    ),
    vscode.commands.registerCommand("ctxloom.checkCompanions", checkCompanions),
    createStatusBar(),
  );

  void checkCompanionsOnStartup();
}

export function deactivate(): void {
  // No-op: subscriptions are disposed by VSCode via context.subscriptions.
}
