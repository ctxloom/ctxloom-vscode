import * as vscode from "vscode";
import {
  bundleLabel,
  listFragments,
  showContent,
  type ContentItem,
} from "./content-data";
import { requireItem } from "./view-util";

/**
 * A bundle group row: a collapsible parent whose children are the fragments that
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
 * A fragment leaf. Subclasses TreeItem to carry the fragment's `ref` so the open
 * command can `fragment show` the exact reference. Clicking the row opens it.
 */
class FragmentItem extends vscode.TreeItem {
  constructor(readonly item: ContentItem) {
    super(item.name, vscode.TreeItemCollapsibleState.None);
    this.description = item.tags.join(", ");
    this.tooltip = item.ref;
    this.contextValue = "ctxloomFragment";
    this.command = {
      command: "ctxloom.fragments.open",
      title: "Open Fragment",
      arguments: [this],
    };
  }
}

type FragmentTreeItem = BundleItem | FragmentItem;

/**
 * The Fragments tree in the ctxloom Activity Bar container. Lists fragments from
 * `fragment list --format json` (via the content-data seam) grouped by bundle:
 * top-level rows are bundles, their children are the fragments. A thin frontend —
 * all logic lives in the CLI and parsing in content-data.ts.
 */
export class FragmentsProvider implements vscode.TreeDataProvider<FragmentTreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-reads the fragment list, repopulating the tree. */
  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: FragmentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FragmentTreeItem): Promise<FragmentTreeItem[]> {
    const fragments = await listFragments();
    if (element instanceof BundleItem) {
      return fragments
        .filter((f) => f.bundle === element.bundle)
        .map((f) => new FragmentItem(f));
    }
    if (element instanceof FragmentItem) {
      return [];
    }
    const bundles: string[] = [];
    const seen = new Set<string>();
    for (const f of fragments) {
      if (!seen.has(f.bundle)) {
        seen.add(f.bundle);
        bundles.push(f.bundle);
      }
    }
    return bundles.map((bundle) => new BundleItem(bundle));
  }
}

/**
 * Opens a fragment's content in a read-only markdown editor by running
 * `fragment show <ref>` and showing the result as an untitled document.
 */
async function openFragment(item: FragmentItem): Promise<void> {
  const text = await showContent(item.item.ref, "fragments");
  const doc = await vscode.workspace.openTextDocument({
    content: text,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc);
}

/**
 * Registers the Fragments commands: refresh and open. The tree is hosted inside
 * the composite Config view (config-view.ts), so `refresh` repaints that view.
 */
export function registerFragmentsCommands(
  context: vscode.ExtensionContext,
  refresh: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.fragments.refresh", () => refresh()),
    vscode.commands.registerCommand("ctxloom.fragments.open", (item: FragmentItem) => {
      if (requireItem(item)) {
        void openFragment(item);
      }
    }),
  );
}
