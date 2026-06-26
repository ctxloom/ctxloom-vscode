// The Plans tree in the ctxloom Activity Bar container. Plans are owned by
// taskloom (see plans-data.ts → `taskloom plan list/show`); this view groups
// them by session harp (top level) with the individual plans as leaves. The
// resume action launches the plan's session through the cli.ts seam.

import * as vscode from "vscode";
import { runInTerminal } from "./cli";
import { listPlans, showPlan, type Plan } from "./plans-data";
import { requireItem } from "./view-util";

/**
 * A session-harp group: a collapsible parent whose children are the plans saved
 * in that session. Carries the harp so the resume action can launch its session.
 */
class SessionGroupItem extends vscode.TreeItem {
  constructor(readonly harp: string) {
    super(harp, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "ctxloomPlanGroup";
    this.iconPath = new vscode.ThemeIcon("history");
  }
}

/**
 * A single plan leaf. Clicking it opens the markdown file; it carries its path
 * and session harp so the open/resume command handlers can act on the selection.
 * The hover tooltip is filled lazily with the plan's content via `plan show`.
 */
class PlanItem extends vscode.TreeItem {
  readonly path: string;
  readonly harp: string;

  constructor(plan: Plan) {
    super(plan.title, vscode.TreeItemCollapsibleState.None);
    this.path = plan.path;
    this.harp = plan.session;
    this.description = plan.name;
    this.tooltip = plan.path;
    this.contextValue = "ctxloomPlan";
    this.resourceUri = vscode.Uri.file(plan.path);
    this.command = {
      command: "ctxloom.plans.open",
      title: "Open Plan",
      arguments: [this],
    };
  }
}

type PlanTreeItem = SessionGroupItem | PlanItem;

/**
 * Supplies the Plans tree: top-level session-harp groups, each expanding to its
 * plans. The list is read once per getChildren of the root so a refresh
 * re-queries taskloom.
 */
class PlansProvider implements vscode.TreeDataProvider<PlanTreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-queries `taskloom plan list` and repaints the tree. */
  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: PlanTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PlanTreeItem): Promise<PlanTreeItem[]> {
    let plans: Plan[];
    try {
      plans = await listPlans();
    } catch (err) {
      void vscode.window.showErrorMessage(`ctxloom: could not list plans: ${String(err)}`);
      return [];
    }
    if (element === undefined) {
      return harpsOf(plans).map((harp) => new SessionGroupItem(harp));
    }
    if (element instanceof SessionGroupItem) {
      return plans
        .filter((p) => p.session === element.harp)
        .map((p) => new PlanItem(p));
    }
    return [];
  }

  /** Fills a plan leaf's tooltip with its content (markdown) on hover. */
  async resolveTreeItem(
    _item: vscode.TreeItem,
    element: PlanTreeItem,
  ): Promise<vscode.TreeItem> {
    if (element instanceof PlanItem) {
      try {
        element.tooltip = new vscode.MarkdownString(await showPlan(element.path));
      } catch {
        // Keep the path tooltip set in the constructor.
      }
    }
    return element;
  }
}

/** The distinct session harps that own at least one plan, in sorted order. */
function harpsOf(plans: Plan[]): string[] {
  return [...new Set(plans.map((p) => p.session))].sort();
}

/**
 * Registers the Plans tree provider and its commands: refresh (re-query
 * taskloom), open (reveal a plan file in the editor) and resume (launch the
 * plan's session via the agent in a terminal). The view id and command ids match
 * the package.json contributions.
 */
export function registerPlansView(context: vscode.ExtensionContext): void {
  const provider = new PlansProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ctxloom.plans", provider),
    vscode.commands.registerCommand("ctxloom.plans.refresh", () => provider.refresh()),
    vscode.commands.registerCommand("ctxloom.plans.open", (item: PlanItem) => {
      if (requireItem(item)) {
        void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(item.path));
      }
    }),
    vscode.commands.registerCommand("ctxloom.plans.resume", (item: PlanItem) => {
      if (requireItem(item)) {
        runInTerminal("ctxloom agent", ["run", "--session", item.harp]);
      }
    }),
  );
}
