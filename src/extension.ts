import * as vscode from "vscode";
import { ChatSession } from "./chat";
import { checkCompanions, checkCompanionsOnStartup } from "./companions";
import { registerConfigView } from "./config-view";
import { registerPlansView } from "./plans-view";
import { runAgent } from "./run";
import { registerSessionsView } from "./sessions-view";
import { createChatStatusBar, createStatusBar } from "./statusbar";
import { registerTasksView } from "./tasks-view";

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
    vscode.commands.registerCommand("ctxloom.selectChatProfile", () =>
      ChatSession.selectProfile(),
    ),
    vscode.commands.registerCommand("ctxloom.newChatSession", () =>
      ChatSession.newSession(),
    ),
    vscode.commands.registerCommand("ctxloom.openSettings", () =>
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:ctxloom.ctxloom",
      ),
    ),
    vscode.commands.registerCommand("ctxloom.checkCompanions", checkCompanions),
    createStatusBar(),
    createChatStatusBar(),
  );

  // Top-level views: Sessions, Plans, Tasks. The remaining management trees
  // (Profiles, Fragments, Prompts, Remotes, ltk) are nested in the composite
  // Config view to keep the sidebar uncluttered.
  registerSessionsView(context);
  registerPlansView(context);
  registerTasksView(context);
  registerConfigView(context);

  void checkCompanionsOnStartup();
}

export function deactivate(): void {
  // No-op: subscriptions are disposed by VSCode via context.subscriptions.
}
