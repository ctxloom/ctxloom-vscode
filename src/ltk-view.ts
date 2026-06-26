import { existsSync } from "node:fs";
import * as vscode from "vscode";
import {
  evaluateCommand,
  ltkConfigPath,
  workspaceDir,
} from "./ltk-data";

/**
 * A single info row in the ltk tree reporting whether this project has an
 * `.ltk/config.yaml`. The view is deliberately thin: ltk is a separate binary
 * with its own rule model, so the GUI only surfaces config presence and the
 * open-config / test / refresh actions (in the view title bar).
 */
class LtkInfoItem extends vscode.TreeItem {
  constructor(label: string, tooltip: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = tooltip;
    this.contextValue = "ctxloomLtkInfo";
  }
}

/**
 * The ltk tree in the ctxloom Activity Bar container. With no workspace folder
 * or no `.ltk/config.yaml` it returns a single hint row (and viewsWelcome can
 * offer to create the file); with a config present it shows a confirming row
 * whose tooltip is the config path.
 */
export class LtkProvider implements vscode.TreeDataProvider<LtkInfoItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-reads config presence, repopulating the tree. */
  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: LtkInfoItem): vscode.TreeItem {
    return element;
  }

  getChildren(): LtkInfoItem[] {
    const dir = workspaceDir();
    if (!dir) {
      return [new LtkInfoItem("No workspace folder open", "Open a folder to use ltk.")];
    }
    const config = ltkConfigPath(dir);
    if (existsSync(config)) {
      return [new LtkInfoItem("Rules: .ltk/config.yaml", config)];
    }
    return [
      new LtkInfoItem(
        "No .ltk/config.yaml",
        "This project has no ltk rules. Use the open-config action to create one.",
      ),
    ];
  }
}

/**
 * Opens (or offers to create) the project's `.ltk/config.yaml` in the editor.
 * When the file is missing, prompts before writing an empty placeholder so the
 * user can start adding rules — then refreshes the tree.
 */
async function openConfig(refresh: () => void): Promise<void> {
  const dir = workspaceDir();
  if (!dir) {
    void vscode.window.showWarningMessage("ltk: no workspace folder is open.");
    return;
  }
  const config = ltkConfigPath(dir);
  const uri = vscode.Uri.file(config);

  if (!existsSync(config)) {
    const choice = await vscode.window.showInformationMessage(
      "No .ltk/config.yaml in this project. Create an empty one?",
      "Create",
      "Cancel",
    );
    if (choice !== "Create") {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, new Uint8Array());
    refresh();
  }

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}

/**
 * Prompts for a shell command, asks `ltk evaluate` whether it would be allowed,
 * and reports the verdict: an allow as an info message, a deny as a warning that
 * includes ltk's message and (when present) its suggested alternative.
 */
async function testCommand(): Promise<void> {
  const command = await vscode.window.showInputBox({
    title: "ltk: test a shell command",
    prompt: "Enter a shell command to check against this project's ltk rules.",
    placeHolder: "rm -rf node_modules",
  });
  if (!command || command.trim() === "") {
    return;
  }

  const decision = await evaluateCommand(command);
  if (decision.allow) {
    void vscode.window.showInformationMessage(`ltk would ALLOW: ${command}`);
    return;
  }

  const parts = [`ltk would DENY: ${command}`];
  if (decision.message) {
    parts.push(decision.message);
  }
  if (decision.suggestion) {
    parts.push(`Use instead: ${decision.suggestion}`);
  }
  void vscode.window.showWarningMessage(parts.join("\n"), { modal: false });
}

/**
 * Registers the ltk tree view and its title-bar commands: open-config
 * (create-or-open `.ltk/config.yaml`), test (evaluate a command against the
 * rules), and refresh. A thin frontend over the ltk binary, mirroring the
 * profiles view's registration shape.
 */
export function registerLtkCommands(
  context: vscode.ExtensionContext,
  refresh: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.ltk.openConfig", () =>
      openConfig(refresh),
    ),
    vscode.commands.registerCommand("ctxloom.ltk.test", () => testCommand()),
    vscode.commands.registerCommand("ctxloom.ltk.refresh", () => refresh()),
  );
}
