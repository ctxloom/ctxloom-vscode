// The Plans tree in the ctxloom Activity Bar container. Plans are owned by
// taskloom (see plans-data.ts → `taskloom plan list/show`); this view lists them
// flat — one row per plan, labelled with its owning session harp — rather than
// nesting them under per-session groups. The resume action opens the plan's
// session in the interactive chat.

import * as vscode from "vscode";
import { ChatSession } from "./chat";
import { listPlans, showPlan, type Plan } from "./plans-data";
import { requireItem } from "./view-util";

/**
 * A single plan row. The label is the plan title and the description is its
 * owning session harp (so the session is visible without nesting). Clicking it
 * opens the markdown file; it carries its path and harp so the open/resume
 * command handlers can act on the selection. The hover tooltip is filled lazily
 * with the plan's content via `plan show`.
 */
class PlanItem extends vscode.TreeItem {
  readonly path: string;
  readonly harp: string;

  constructor(readonly plan: Plan) {
    super(plan.title, vscode.TreeItemCollapsibleState.None);
    this.path = plan.path;
    this.harp = plan.session;
    this.description = plan.session;
    // A useful tooltip up front (title · name · session); resolveTreeItem swaps
    // in the plan's content on hover. Without this the hover would briefly show
    // only the file path until the async content loads.
    this.tooltip = planTooltip(plan);
    this.contextValue = "ctxloomPlan";
    this.iconPath = new vscode.ThemeIcon("note");
    this.resourceUri = vscode.Uri.file(plan.path);
    this.command = {
      command: "ctxloom.plans.open",
      title: "Open Plan",
      arguments: [this],
    };
  }
}

/**
 * The hover for a plan: a header (title · name · session) plus, once loaded, an
 * excerpt of the plan's content. Kept to an excerpt so a long plan doesn't make
 * an unwieldy tooltip.
 */
function planTooltip(plan: Plan, body?: string): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${plan.title}**\n\n`);
  md.appendMarkdown(`\`${plan.name}.plan.md\` · session \`${plan.session}\``);
  const text = body?.trim();
  if (text !== undefined && text !== "") {
    const excerpt = text.length > 1500 ? `${text.slice(0, 1500)}\n\n…` : text;
    md.appendMarkdown(`\n\n---\n\n${excerpt}`);
  }
  return md;
}

/**
 * Supplies the Plans tree: a flat list of plans (sorted by session, then title).
 * The list is re-read on every refresh from `taskloom plan list`.
 */
class PlansProvider implements vscode.TreeDataProvider<PlanItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-queries `taskloom plan list` and repaints the tree. */
  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: PlanItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PlanItem): Promise<PlanItem[]> {
    if (element !== undefined) {
      return []; // flat list — rows have no children
    }
    let plans: Plan[];
    try {
      plans = await listPlans();
    } catch (err) {
      void vscode.window.showErrorMessage(`ctxloom: could not list plans: ${String(err)}`);
      return [];
    }
    return [...plans]
      .sort((a, b) => a.session.localeCompare(b.session) || a.title.localeCompare(b.title))
      .map((plan) => new PlanItem(plan));
  }

  /** Fills a plan row's tooltip with its content (markdown) on hover. */
  async resolveTreeItem(
    _item: vscode.TreeItem,
    element: PlanItem,
  ): Promise<vscode.TreeItem> {
    try {
      element.tooltip = planTooltip(element.plan, await showPlan(element.path));
    } catch {
      // Keep the title · name · session tooltip set in the constructor.
    }
    return element;
  }
}

/**
 * Registers the Plans tree provider and its commands: refresh (re-query
 * taskloom), open (reveal a plan file in the editor) and resume (open the plan's
 * session in the interactive chat). The view id and command ids match the
 * package.json contributions.
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
        ChatSession.resume(context, item.harp);
      }
    }),
  );
}
