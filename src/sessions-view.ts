import * as vscode from "vscode";
import { exec, runInTerminal } from "./cli";
import { listSessions, sessionEssence, type Session } from "./sessions-data";
import { requireItem } from "./view-util";

/** The shown-on-hover text for a session that hasn't been distilled yet. */
const NOT_DISTILLED = "Not distilled yet — run Distill";

/**
 * A tree node for one recorded session. It carries the session's harp name so
 * the resume/distill/rename/forget command handlers — which receive the selected
 * TreeItem — can act without re-querying. `contextValue` lets the item menus
 * target sessions, and a stable `id` keeps selection across refreshes.
 */
export class SessionItem extends vscode.TreeItem {
  readonly harpName: string;

  constructor(session: Session) {
    super(session.harpName, vscode.TreeItemCollapsibleState.None);
    this.harpName = session.harpName;
    this.id = session.harpName;
    this.description = describeTime(session.endedAt || session.startedAt);
    this.contextValue = "ctxloomSession";
    this.iconPath = new vscode.ThemeIcon("comment-discussion");
    // The full markdown essence is fetched lazily in resolveTreeItem; until then
    // a plain hint avoids a fetch per row on first render.
    this.tooltip = NOT_DISTILLED;
  }
}

/**
 * The Sessions tree in the ctxloom Activity Bar container: one row per recorded
 * session, read from `session list --format json` through the cli.ts seam. The
 * distilled essence is shown on hover (resolved lazily) and resume / distill /
 * rename / forget are wired as item actions.
 */
export class SessionsProvider implements vscode.TreeDataProvider<SessionItem> {
  private readonly changed = new vscode.EventEmitter<SessionItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-reads the session list. */
  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<SessionItem[]> {
    let sessions: Session[];
    try {
      sessions = await listSessions();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `ctxloom: could not list sessions: ${String(err)}`,
      );
      return [];
    }
    return sessions.map((s) => new SessionItem(s));
  }

  /**
   * Fills the hovered item's tooltip with its distilled essence (rendered as
   * markdown), or a "not distilled" hint when the session has no essence yet.
   * Done here so the (potentially slow) `session show` only runs on hover.
   */
  async resolveTreeItem(
    _item: vscode.TreeItem,
    element: SessionItem,
  ): Promise<vscode.TreeItem> {
    const essence = await sessionEssence(element.harpName);
    element.tooltip = essence
      ? new vscode.MarkdownString(essence)
      : NOT_DISTILLED;
    return element;
  }
}

/**
 * Registers the Sessions tree provider and its commands (refresh / resume /
 * distill / rename / forget). The action commands receive the selected
 * SessionItem; ones that mutate state refresh the view when they finish.
 */
export function registerSessionsView(context: vscode.ExtensionContext): void {
  const provider = new SessionsProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ctxloom.sessions", provider),
    vscode.commands.registerCommand("ctxloom.sessions.refresh", () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand("ctxloom.sessions.resume", (item: SessionItem) => {
      if (requireItem(item)) {
        runInTerminal("ctxloom agent", ["run", "--session", item.harpName]);
      }
    }),
    vscode.commands.registerCommand("ctxloom.sessions.distill", (item: SessionItem) => {
      if (requireItem(item)) {
        void distill(provider, item.harpName);
      }
    }),
    vscode.commands.registerCommand("ctxloom.sessions.rename", (item: SessionItem) => {
      if (requireItem(item)) {
        void rename(provider, item.harpName);
      }
    }),
    vscode.commands.registerCommand("ctxloom.sessions.forget", (item: SessionItem) => {
      if (requireItem(item)) {
        void forget(provider, item.harpName);
      }
    }),
  );
}

/** Distills a session, then refreshes so its essence becomes available on hover. */
async function distill(provider: SessionsProvider, harp: string): Promise<void> {
  try {
    await exec(["session", "distill", harp]);
  } catch (err) {
    void vscode.window.showErrorMessage(`ctxloom: could not distill ${harp}: ${String(err)}`);
    return;
  }
  provider.refresh();
}

/** Prompts for a new harp name and renames the session, then refreshes. */
async function rename(provider: SessionsProvider, harp: string): Promise<void> {
  const newName = await vscode.window.showInputBox({
    prompt: `Rename session "${harp}"`,
    value: harp,
  });
  const trimmed = newName?.trim();
  if (!trimmed || trimmed === harp) {
    return;
  }
  try {
    await exec(["session", "rename", harp, trimmed]);
  } catch (err) {
    void vscode.window.showErrorMessage(`ctxloom: could not rename ${harp}: ${String(err)}`);
    return;
  }
  provider.refresh();
}

/** Confirms (modal) then forgets the session, refreshing the view on success. */
async function forget(provider: SessionsProvider, harp: string): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    `Forget session "${harp}"? This cannot be undone.`,
    { modal: true },
    "Forget",
  );
  if (choice !== "Forget") {
    return;
  }
  try {
    await exec(["session", "forget", harp]);
  } catch (err) {
    void vscode.window.showErrorMessage(`ctxloom: could not forget ${harp}: ${String(err)}`);
    return;
  }
  provider.refresh();
}

/**
 * A short, human-friendly description of when a session last ran: a relative
 * label ("3m ago", "2d ago") for recent times, falling back to the absolute
 * local date for older ones. An unparseable/empty timestamp yields "".
 */
export function describeTime(iso: string, now: number = Date.now()): string {
  if (!iso) {
    return "";
  }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return "";
  }
  const seconds = Math.round((now - t) / 1000);
  if (seconds < 0) {
    return new Date(t).toLocaleString();
  }
  if (seconds < 60) {
    return "just now";
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(t).toLocaleDateString();
}
