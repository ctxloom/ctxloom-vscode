import * as vscode from "vscode";
import { exec } from "./cli";
import {
  bundleLabel,
  bundleSource,
  listFragments,
  listPrompts,
  type ContentItem,
  type ContentKind,
} from "./content-data";
import type { OpenContentArgs } from "./content-actions";
import { listRemotes, type Remote } from "./remotes-data";
import { requireItem } from "./view-util";

/**
 * A tree node for one configured remote. It carries the remote's name (for the
 * pull/trust handlers) and url (to match its bundles), and expands to the
 * remote's bundles → fragments/prompts. `contextValue` distinguishes trusted
 * from untrusted remotes so the Trust action shows only where it applies.
 */
export class RemoteItem extends vscode.TreeItem {
  readonly remoteName: string;
  readonly url: string;

  constructor(remote: Remote) {
    super(remote.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.remoteName = remote.name;
    this.url = remote.url;
    this.id = remote.name;
    this.description = remote.url;
    this.contextValue = remote.trusted === false ? "ctxloomRemoteUntrusted" : "ctxloomRemote";
    this.iconPath = new vscode.ThemeIcon(
      remote.trusted === false ? "shield" : "remote",
    );
    this.tooltip = describeRemote(remote);
  }
}

/** One fragment or prompt, tagged with its kind. */
interface RemoteContentEntry {
  item: ContentItem;
  kind: ContentKind;
}

/** A bundle published by a remote; expands to its fragments and prompts. */
class RemoteBundleItem extends vscode.TreeItem {
  constructor(
    readonly bundleRef: string,
    readonly entries: RemoteContentEntry[],
  ) {
    super(bundleLabel(bundleRef), vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = bundleRef;
    this.contextValue = "ctxloomRemoteBundle";
    this.iconPath = new vscode.ThemeIcon("package");
  }
}

/** A fragment or prompt leaf under a remote bundle; opens its content on click. */
class RemoteContentItem extends vscode.TreeItem {
  constructor(item: ContentItem, kind: ContentKind) {
    super(item.name, vscode.TreeItemCollapsibleState.None);
    this.description = kind === "fragments" ? "fragment" : "prompt";
    this.tooltip = item.ref;
    this.contextValue = "ctxloomRemoteContent";
    this.iconPath = new vscode.ThemeIcon(kind === "fragments" ? "note" : "lightbulb");
    const args: OpenContentArgs = { ref: item.ref, kind };
    this.command = { command: "ctxloom.content.open", title: "Open", arguments: [args] };
  }
}

type RemoteTreeItem = RemoteItem | RemoteBundleItem | RemoteContentItem;

/** A multi-line hover describing a remote's url, default flag, and trust state. */
export function describeRemote(remote: Remote): string {
  const lines = [`${remote.name}`, remote.url];
  if (remote.isDefault) {
    lines.push("default");
  }
  if (remote.trusted !== undefined) {
    lines.push(remote.trusted ? "trusted" : "untrusted — changes require review");
  }
  return lines.join("\n");
}

/**
 * The Remotes tree in the ctxloom Activity Bar container: one row per configured
 * remote, read from `remote list --format json` through the cli.ts seam. Add /
 * pull / trust are wired as view and item actions.
 */
export class RemotesProvider implements vscode.TreeDataProvider<RemoteTreeItem> {
  private readonly changed = new vscode.EventEmitter<RemoteTreeItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-reads the remote list. */
  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(element: RemoteTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RemoteTreeItem): Promise<RemoteTreeItem[]> {
    if (element === undefined) {
      return this.rootRemotes();
    }
    if (element instanceof RemoteItem) {
      return this.bundlesOf(element.url);
    }
    if (element instanceof RemoteBundleItem) {
      return element.entries.map((e) => new RemoteContentItem(e.item, e.kind));
    }
    return [];
  }

  private async rootRemotes(): Promise<RemoteItem[]> {
    try {
      return (await listRemotes()).map((r) => new RemoteItem(r));
    } catch (err) {
      void vscode.window.showErrorMessage(`ctxloom: could not list remotes: ${String(err)}`);
      return [];
    }
  }

  /**
   * The bundles a remote publishes, derived by grouping every fragment/prompt
   * whose bundle source (the part before "@bundles/") is the remote's url. A
   * remote with no pulled content yields no bundles.
   */
  private async bundlesOf(url: string): Promise<RemoteBundleItem[]> {
    let entries: RemoteContentEntry[];
    try {
      const [fragments, prompts] = await Promise.all([listFragments(), listPrompts()]);
      entries = [
        ...fragments.map((item): RemoteContentEntry => ({ item, kind: "fragments" })),
        ...prompts.map((item): RemoteContentEntry => ({ item, kind: "prompts" })),
      ];
    } catch (err) {
      void vscode.window.showErrorMessage(`ctxloom: could not list remote content: ${String(err)}`);
      return [];
    }
    const byBundle = new Map<string, RemoteContentEntry[]>();
    for (const entry of entries) {
      if (bundleSource(entry.item.bundle) !== url) {
        continue;
      }
      const group = byBundle.get(entry.item.bundle) ?? [];
      group.push(entry);
      byBundle.set(entry.item.bundle, group);
    }
    return [...byBundle.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bundleRef, group]) => new RemoteBundleItem(bundleRef, group));
  }
}

/**
 * Registers the Remotes tree provider and its commands (refresh / add / pull /
 * trust). The item action commands receive the selected RemoteItem; ones that
 * mutate state refresh the view when they finish.
 */
export function registerRemotesCommands(
  context: vscode.ExtensionContext,
  refresh: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.remotes.refresh", () => refresh()),
    vscode.commands.registerCommand("ctxloom.remotes.add", () => addRemote(refresh)),
    // `remote pull` resolves every dependency declared across the project's
    // profiles — it is not per-remote, so it takes no item.
    vscode.commands.registerCommand("ctxloom.remotes.pull", () => pullRemote(refresh)),
    vscode.commands.registerCommand("ctxloom.remotes.trust", (item: RemoteItem) => {
      if (requireItem(item)) {
        void trustRemote(refresh, item.remoteName);
      }
    }),
  );
}

/** Prompts for a name and URL, registers the remote, then refreshes the view. */
async function addRemote(refresh: () => void): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "Remote name",
    placeHolder: "e.g. alice",
  });
  const trimmedName = name?.trim();
  if (!trimmedName) {
    return;
  }
  const url = await vscode.window.showInputBox({
    prompt: `URL for remote "${trimmedName}"`,
    placeHolder: "alice/ctxloom or https://github.com/alice/ctxloom",
  });
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) {
    return;
  }
  try {
    await exec(["remote", "add", trimmedName, trimmedUrl]);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ctxloom: could not add remote ${trimmedName}: ${String(err)}`,
    );
    return;
  }
  refresh();
}

/**
 * Pulls remote dependencies, then refreshes. `ctxloom remote pull` resolves all
 * dependencies declared across the project's profiles — it is project-wide, not
 * per-remote — so it takes no remote name.
 */
async function pullRemote(refresh: () => void): Promise<void> {
  try {
    await exec(["remote", "pull"]);
  } catch (err) {
    void vscode.window.showErrorMessage(`ctxloom: could not pull remotes: ${String(err)}`);
    return;
  }
  void vscode.window.showInformationMessage("ctxloom: pulled remote dependencies");
  refresh();
}

/** Trusts the remote so its bundle changes auto-apply, then refreshes the view. */
async function trustRemote(refresh: () => void, name: string): Promise<void> {
  try {
    await exec(["remote", "trust", name]);
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ctxloom: could not trust ${name}: ${String(err)}`,
    );
    return;
  }
  refresh();
}
