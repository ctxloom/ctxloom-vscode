import * as vscode from "vscode";
import { exec, listProfiles, runInTerminal } from "./cli";
import { createProfile } from "./profile-data";
import { ProfileComposer } from "./profile-composer";
import { type Profile } from "./profiles";
import { requireItem } from "./view-util";

/**
 * A profile row in the Profiles tree. Subclasses TreeItem to carry the profile's
 * full `name` (the value passed to `ctxloom run -p` and the profile subcommands)
 * separately from its backend-supplied `displayName`, so the item-context
 * commands act on the exact reference even when a remote profile shows a short
 * label.
 */
class ProfileItem extends vscode.TreeItem {
  constructor(readonly profile: Profile) {
    super(profile.displayName, vscode.TreeItemCollapsibleState.None);
    this.description = profile.isDefault ? "default" : undefined;
    this.tooltip = profile.description;
    this.contextValue = "ctxloomProfile";
    // Clicking a profile opens the composer for it.
    this.command = {
      command: "ctxloom.profiles.compose",
      title: "Compose Profile",
      arguments: [this],
    };
  }
}

/**
 * The Profiles tree in the ctxloom Activity Bar container. Lists one row per
 * profile from `profile list --format json` (via the cli.ts seam), marking the
 * configured default and exposing set-default / edit / create actions. A thin
 * frontend: all profile logic lives in the CLI and parsing in profiles.ts.
 */
export class ProfilesProvider implements vscode.TreeDataProvider<ProfileItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  /** Re-reads the profile list, repopulating the tree. */
  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(element: ProfileItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ProfileItem[]> {
    const profiles = await listProfiles();
    return profiles.map((profile) => new ProfileItem(profile));
  }
}

/**
 * Registers the Profiles commands: refresh, set-default (`profile default
 * <name>` then refresh), edit (`profile edit <name>` in a terminal, since it
 * opens an editor), and create (`profile create` in a terminal, since it prompts
 * interactively). The Profiles tree itself is hosted inside the composite Config
 * view (config-view.ts), so `refresh` repaints that view rather than a
 * standalone one.
 */
export function registerProfilesCommands(
  context: vscode.ExtensionContext,
  refresh: () => void,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.profiles.refresh", () => refresh()),
    vscode.commands.registerCommand(
      "ctxloom.profiles.setDefault",
      async (item: ProfileItem) => {
        if (!requireItem(item)) {
          return;
        }
        await exec(["profile", "default", item.profile.name]);
        refresh();
      },
    ),
    vscode.commands.registerCommand("ctxloom.profiles.edit", (item: ProfileItem) => {
      if (requireItem(item)) {
        runInTerminal("ctxloom", ["profile", "edit", item.profile.name]);
      }
    }),
    vscode.commands.registerCommand("ctxloom.profiles.compose", (item: ProfileItem) => {
      if (requireItem(item)) {
        ProfileComposer.show(context, item.profile.name);
      }
    }),
    vscode.commands.registerCommand("ctxloom.profiles.create", () =>
      void createAndCompose(context, refresh),
    ),
  );
}

/**
 * Prompts for a name, creates an empty profile, then opens the composer on it so
 * the user immediately assembles its content.
 */
async function createAndCompose(
  context: vscode.ExtensionContext,
  refresh: () => void,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: "New profile name",
    placeHolder: "e.g. reviewer",
    validateInput: (v) =>
      /^[A-Za-z0-9._-]+$/.test(v.trim()) ? undefined : "Use letters, digits, dot, dash, underscore.",
  });
  const trimmed = name?.trim();
  if (!trimmed) {
    return;
  }
  try {
    await createProfile(trimmed);
  } catch (err) {
    void vscode.window.showErrorMessage(`ctxloom: could not create ${trimmed}: ${String(err)}`);
    return;
  }
  refresh();
  ProfileComposer.show(context, trimmed);
}
