import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { ChatSession } from "./chat";
import { exec } from "./cli";
import { listSessions, type Session } from "./sessions-data";
import { cliError, requireItem } from "./view-util";

/**
 * Hover for a session with no distilled summary yet — nudges to distill, showing
 * the distill (clock) icon inline next to the action so it maps to the row's
 * Distill button. A MarkdownString with supportThemeIcons renders the codicon.
 */
function distillHint(): vscode.MarkdownString {
  const hint = new vscode.MarkdownString(
    "Not distilled yet — run $(history) Distill to generate a summary",
  );
  hint.supportThemeIcons = true;
  return hint;
}

/**
 * A tree node for one recorded session. It carries the session's harp name so
 * the resume/distill/rename/forget command handlers — which receive the selected
 * TreeItem — can act without re-querying. `contextValue` lets the item menus
 * target sessions, and a stable `id` keeps selection across refreshes.
 */
export class SessionItem extends vscode.TreeItem {
  readonly harpName: string;
  readonly transcriptPath: string;
  readonly distilled: boolean;

  constructor(session: Session, distilling = false) {
    // Name is the distilled summary once there is one, else the harp name.
    super(
      session.summary !== "" ? session.summary : session.harpName,
      vscode.TreeItemCollapsibleState.None,
    );
    this.harpName = session.harpName;
    this.transcriptPath = session.transcriptPath;
    this.distilled = session.distilled;
    this.id = session.harpName;
    this.contextValue = "ctxloomSession";
    // Clicking a session opens its distilled essence (if distilled) or its raw
    // transcript .jsonl; the raw transcript is always available via right-click.
    this.command = {
      command: "ctxloom.sessions.open",
      title: "Open Session",
      arguments: [this],
    };
    if (distilling) {
      // The standard spinning progress indicator on the row while `session
      // distill` runs (the inline menu-button icon can't animate), so the
      // potentially slow distillation is visibly in progress.
      this.description = "distilling…";
      this.iconPath = new vscode.ThemeIcon("loading~spin");
      this.tooltip = "Distilling…";
      return;
    }
    this.description = describeTime(session.endedAt || session.startedAt);
    this.iconPath = new vscode.ThemeIcon("comment-discussion");
    // Hover shows the summary alone (the harp's name when undistilled is in the
    // label), or a nudge to distill (with the clock icon) when there's no
    // summary yet.
    this.tooltip = session.summary !== "" ? session.summary : distillHint();
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
  // Harp names currently being distilled, so their rows render a spinner. The
  // distill command flips a name on/off and the toggle repaints the tree.
  private readonly distilling = new Set<string>();

  /** Re-reads the session list. */
  refresh(): void {
    this.changed.fire(undefined);
  }

  /** Marks a session as (not) distilling and repaints so its spinner toggles. */
  setDistilling(harp: string, on: boolean): void {
    if (on) {
      this.distilling.add(harp);
    } else {
      this.distilling.delete(harp);
    }
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
    return sessions.map((s) => new SessionItem(s, this.distilling.has(s.harpName)));
  }
}

/**
 * Registers the Sessions tree provider and its commands (refresh / resume /
 * distill / rename / forget). The action commands receive the selected
 * SessionItem; ones that mutate state refresh the view when they finish. The
 * shared not-a-Git-root warning (git-warning.ts) contributes the amber title-bar
 * button via a context key.
 */
export function registerSessionsView(context: vscode.ExtensionContext): void {
  const provider = new SessionsProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ctxloom.sessions", provider),
    vscode.commands.registerCommand("ctxloom.sessions.refresh", () => {
      provider.refresh();
    }),
    vscode.commands.registerCommand("ctxloom.sessions.open", (item: SessionItem) => {
      if (!requireItem(item)) {
        return;
      }
      // Clicking opens the distilled essence when there is one; otherwise the
      // raw transcript. The raw transcript stays reachable via the right-click
      // "Open Raw Transcript" item.
      const essence = essencePath(item.harpName);
      if (item.distilled && existsSync(essence)) {
        void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(essence));
        return;
      }
      openRawTranscript(item);
    }),
    vscode.commands.registerCommand("ctxloom.sessions.openRaw", (item: SessionItem) => {
      if (requireItem(item)) {
        openRawTranscript(item);
      }
    }),
    vscode.commands.registerCommand("ctxloom.sessions.resume", (item: SessionItem) => {
      if (requireItem(item)) {
        ChatSession.resume(context, item.harpName);
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

/** Path to a session's distilled essence under ~/.ctxloom/sessions/<harp>/. */
function essencePath(harp: string): string {
  return join(homedir(), ".ctxloom", "sessions", harp, "essence.md");
}

/** Opens a session's raw transcript .jsonl, or hints when it's not on disk. */
function openRawTranscript(item: SessionItem): void {
  if (item.transcriptPath === "" || !existsSync(item.transcriptPath)) {
    void vscode.window.showInformationMessage(
      `ctxloom: no transcript on disk for ${item.harpName}.`,
    );
    return;
  }
  void vscode.commands.executeCommand("vscode.open", vscode.Uri.file(item.transcriptPath));
}

/**
 * Distills a session, showing progress on its row (a spinning ring) and in the
 * window status bar while `session distill` runs. Clearing the distilling flag
 * repaints the tree, so on success the fresh essence becomes available on hover
 * and click; a confirming toast removes the "did it work?" doubt.
 */
async function distill(provider: SessionsProvider, harp: string): Promise<void> {
  provider.setDistilling(harp, true);
  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `ctxloom: distilling ${harp}…`,
      },
      () => exec(["session", "distill", harp]),
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`ctxloom: could not distill ${harp}: ${cliError(err)}`);
    return;
  } finally {
    provider.setDistilling(harp, false);
  }
  void vscode.window.showInformationMessage(`ctxloom: distilled ${harp}.`);
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
