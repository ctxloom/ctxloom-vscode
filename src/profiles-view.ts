import * as vscode from "vscode";
import { ChatSession } from "./chat";
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
 * label. A filled star marks the project's configured default so the state is
 * visible at a glance and visibly moves when the default changes.
 */
class ProfileItem extends vscode.TreeItem {
  constructor(readonly profile: Profile) {
    super(profile.displayName, vscode.TreeItemCollapsibleState.None);
    this.description = profile.isDefault ? "default" : undefined;
    this.tooltip = profile.description;
    this.contextValue = "ctxloomProfile";
    this.iconPath = new vscode.ThemeIcon(profile.isDefault ? "star-full" : "library");
    // Clicking a profile opens the composer for it.
    this.command = {
      command: "ctxloom.profiles.compose",
      title: "Compose Profile",
      arguments: [this],
    };
  }
}

/**
 * The Profiles tree: a top-level row in the ctxloom Activity Bar container, one
 * row per profile from `profile list --format json` (via the cli.ts seam),
 * marking the configured default and exposing open-chat / set-default / compose /
 * edit / create actions. A thin frontend: all profile logic lives in the CLI and
 * parsing in profiles.ts.
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
    let profiles: Profile[];
    try {
      profiles = await listProfiles();
    } catch (err) {
      void vscode.window.showErrorMessage(
        `ctxloom: could not list profiles: ${String(err)}`,
      );
      return [];
    }
    return profiles.map((profile) => new ProfileItem(profile));
  }
}

/**
 * Registers the standalone Profiles tree and its commands: open-chat (launch a
 * chat running the profile), set-default (make this the sole default), compose
 * (the profile composer), edit (`profile edit` in a terminal, since it opens an
 * editor), create, and refresh. Mutating actions repaint the view when they
 * finish.
 */
export function registerProfilesView(context: vscode.ExtensionContext): void {
  const provider = new ProfilesProvider();
  const refresh = (): void => provider.refresh();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("ctxloom.profiles", provider),
    vscode.commands.registerCommand("ctxloom.profiles.refresh", refresh),
    vscode.commands.registerCommand(
      "ctxloom.profiles.openChat",
      (item: ProfileItem) => {
        if (requireItem(item)) {
          ChatSession.open(context, {
            name: item.profile.name,
            label: item.profile.displayName,
          });
        }
      },
    ),
    vscode.commands.registerCommand(
      "ctxloom.profiles.setDefault",
      (item: ProfileItem) => {
        if (requireItem(item)) {
          void setDefault(item.profile, refresh);
        }
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
 * Makes `target` the project's sole default profile. The backend default is a
 * list (multiple defaults may coexist), but the GUI action means "make this THE
 * default", so any other current defaults are unset first — otherwise the star
 * would appear to stick on the old profile. A no-op if it is already the only
 * default.
 */
async function setDefault(target: Profile, refresh: () => void): Promise<void> {
  try {
    const profiles = await listProfiles();
    for (const p of profiles) {
      if (p.isDefault && p.name !== target.name) {
        await exec(["profile", "default", "--unset", p.name]);
      }
    }
    if (!target.isDefault) {
      await exec(["profile", "default", target.name]);
    }
  } catch (err) {
    void vscode.window.showErrorMessage(
      `ctxloom: could not set ${target.displayName} as default: ${String(err)}`,
    );
    return;
  }
  refresh();
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
