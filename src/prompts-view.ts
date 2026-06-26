import * as vscode from "vscode";
import {
  bundleLabel,
  listPrompts,
  showContent,
  type ContentItem,
} from "./content-data";
import { requireItem } from "./view-util";

/**
 * A bundle group row: a collapsible parent whose children are the prompts that
 * belong to it. Carries the full `bundle` reference so getChildren can re-filter,
 * while displaying the short label.
 */
class BundleItem extends vscode.TreeItem {
  constructor(readonly bundle: string) {
    super(bundleLabel(bundle), vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = bundle;
    this.contextValue = "ctxloomBundle";
  }
}

/**
 * A prompt leaf. Subclasses TreeItem to carry the prompt's `ref` so the open
 * command can `prompt show` the exact reference. Clicking the row opens it.
 */
class PromptItem extends vscode.TreeItem {
  constructor(readonly item: ContentItem) {
    super(item.name, vscode.TreeItemCollapsibleState.None);
    this.description = item.tags.join(", ");
    this.tooltip = item.ref;
    this.contextValue = "ctxloomPrompt";
    this.command = {
      command: "ctxloom.prompts.open",
      title: "Open Prompt",
      arguments: [this],
    };
  }
}

type PromptTreeItem = BundleItem | PromptItem;

/**
 * The Prompts tree in the ctxloom Activity Bar container. Lists prompts from
 * `prompt list --format json` (via the content-data seam) grouped by bundle:
 * top-level rows are bundles, their children are the prompts. A thin frontend —
 * all logic lives in the CLI and parsing in content-data.ts.
 */
export class PromptsProvider implements vscode.TreeDataProvider<PromptTreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-reads the prompt list, repopulating the tree. */
  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: PromptTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PromptTreeItem): Promise<PromptTreeItem[]> {
    const prompts = await listPrompts();
    if (element instanceof BundleItem) {
      return prompts
        .filter((p) => p.bundle === element.bundle)
        .map((p) => new PromptItem(p));
    }
    if (element instanceof PromptItem) {
      return [];
    }
    const bundles: string[] = [];
    const seen = new Set<string>();
    for (const p of prompts) {
      if (!seen.has(p.bundle)) {
        seen.add(p.bundle);
        bundles.push(p.bundle);
      }
    }
    return bundles.map((bundle) => new BundleItem(bundle));
  }
}

/**
 * Opens a prompt's content in a read-only markdown editor by running
 * `prompt show <ref>` and showing the result as an untitled document.
 */
async function openPrompt(item: PromptItem): Promise<void> {
  const text = await showContent(item.item.ref, "prompts");
  const doc = await vscode.workspace.openTextDocument({
    content: text,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc);
}

/**
 * Registers the Prompts commands: refresh and open. The tree is hosted inside
 * the composite Config view (config-view.ts), so `refresh` repaints that view.
 */
export function registerPromptsCommands(
  context: vscode.ExtensionContext,
  refresh: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.prompts.refresh", () => refresh()),
    vscode.commands.registerCommand("ctxloom.prompts.open", (item: PromptItem) => {
      if (requireItem(item)) {
        void openPrompt(item);
      }
    }),
  );
}
