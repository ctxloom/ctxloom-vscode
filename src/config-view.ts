import * as vscode from "vscode";
import { registerContentActions } from "./content-actions";
import { FragmentsProvider, registerFragmentsCommands } from "./fragments-view";
import { LtkProvider, registerLtkCommands } from "./ltk-view";
import { PromptsProvider, registerPromptsCommands } from "./prompts-view";
import { RemotesProvider, registerRemotesCommands } from "./remotes-view";

// The Config view folds the lower-traffic management trees — Fragments, Prompts,
// Remotes, ltk — under one collapsible Activity Bar section, so the sidebar's top
// level stays Profiles / Sessions / Plans / Tasks. Each domain keeps its own
// provider and commands; this view just composes them.

/**
 * A tree provider the Config view delegates a subtree to. The existing domain
 * providers satisfy this structurally — method parameters are bivariant, so a
 * provider whose getChildren takes its own item type still matches.
 */
interface SubTree {
  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]>;
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem>;
}

interface Category {
  label: string;
  icon: vscode.ThemeIcon | vscode.Uri;
  contextValue: string;
  provider: SubTree;
}

/** A top-level category row in the Config tree, carrying its sub-provider. */
class CategoryItem extends vscode.TreeItem {
  constructor(readonly category: Category) {
    super(category.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = category.contextValue;
    this.iconPath = category.icon;
  }
}

/**
 * The composite Config tree: a single view whose top-level rows are categories,
 * each expanding to its domain provider's tree. Delegation uses an owner WeakMap
 * so arbitrary-depth subtrees (e.g. fragments grouped by bundle) route back to
 * the right provider without the domain providers knowing they are nested.
 */
class ConfigProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly owner = new WeakMap<vscode.TreeItem, SubTree>();

  constructor(private readonly categories: Category[]) {}

  /** Repaints the whole Config tree (every domain refresh routes here). */
  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (element instanceof CategoryItem) {
      return element;
    }
    const sub = this.owner.get(element);
    return sub ? sub.getTreeItem(element) : element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (element === undefined) {
      return this.categories.map((c) => new CategoryItem(c));
    }
    const sub =
      element instanceof CategoryItem ? element.category.provider : this.owner.get(element);
    if (!sub) {
      return [];
    }
    const parent = element instanceof CategoryItem ? undefined : element;
    const children = (await sub.getChildren(parent)) ?? [];
    for (const child of children) {
      this.owner.set(child, sub);
    }
    return children;
  }
}

/**
 * Registers the composite Config view and the commands of every domain it hosts.
 * Each domain's refresh/mutation actions are wired to repaint this one view.
 */
export function registerConfigView(context: vscode.ExtensionContext): void {
  const ltkIcon = vscode.Uri.joinPath(context.extensionUri, "media/icons/ltk/ltk-mono.svg");
  const config = new ConfigProvider([
    {
      label: "Fragments",
      icon: new vscode.ThemeIcon("note"),
      contextValue: "ctxloomConfigFragments",
      provider: new FragmentsProvider(),
    },
    {
      label: "Prompts",
      icon: new vscode.ThemeIcon("lightbulb"),
      contextValue: "ctxloomConfigPrompts",
      provider: new PromptsProvider(),
    },
    {
      label: "Remotes",
      icon: new vscode.ThemeIcon("cloud"),
      contextValue: "ctxloomConfigRemotes",
      provider: new RemotesProvider(),
    },
    {
      label: "ltk",
      icon: ltkIcon,
      contextValue: "ctxloomConfigLtk",
      provider: new LtkProvider(),
    },
  ]);

  const refresh = (): void => config.refresh();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ctxloom.config", config),
    vscode.commands.registerCommand("ctxloom.config.refresh", refresh),
  );
  registerContentActions(context);
  registerFragmentsCommands(context, refresh);
  registerPromptsCommands(context, refresh);
  registerRemotesCommands(context, refresh);
  registerLtkCommands(context, refresh);
}
