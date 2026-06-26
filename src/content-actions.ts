import * as vscode from "vscode";
import { showContent, type ContentKind } from "./content-data";
import { cliError } from "./view-util";

/** Arguments for the ctxloom.content.open command. */
export interface OpenContentArgs {
  ref: string;
  kind: ContentKind;
}

/**
 * Opens a fragment/prompt's content (`<kind> show <ref>`) in a markdown editor
 * tab. Shared by the Fragments/Prompts trees and the per-remote content leaves so
 * "open this item" behaves identically everywhere.
 */
export async function openContent(ref: string, kind: ContentKind): Promise<void> {
  let text: string;
  try {
    text = await showContent(ref, kind);
  } catch (err) {
    // A fragment/prompt that won't load is almost always a remote bundle that
    // hasn't been pulled yet — recoverable, so offer the fix rather than treating
    // it as a dead entry to delete.
    const pull = "Pull Remotes";
    const choice = await vscode.window.showWarningMessage(
      `ctxloom: could not open ${ref}: ${cliError(err)}. It may be a remote that isn't pulled.`,
      pull,
    );
    if (choice === pull) {
      await vscode.commands.executeCommand("ctxloom.remotes.pull");
    }
    return;
  }
  const doc = await vscode.workspace.openTextDocument({ content: text, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: true });
}

/** Registers the shared ctxloom.content.open command (item carries ref + kind). */
export function registerContentActions(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("ctxloom.content.open", (args: OpenContentArgs | undefined) => {
      if (args && typeof args.ref === "string") {
        void openContent(args.ref, args.kind);
      }
    }),
  );
}
