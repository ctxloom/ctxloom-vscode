import * as vscode from "vscode";

/**
 * Renders markdown to HTML using VS Code's own renderer — the built-in
 * `markdown.api.render` command, the same markdown-it instance the Markdown
 * preview uses — so the chat panel doesn't bundle a markdown library (DRY).
 *
 * Returns undefined when the renderer is unavailable or fails (e.g. the built-in
 * markdown extension didn't activate), letting the caller fall back to showing
 * the raw text. Scripts/inline handlers in the output are inert in the webview:
 * its CSP allows only nonce-tagged scripts, and innerHTML never executes
 * <script> tags.
 */
export async function renderMarkdown(text: string): Promise<string | undefined> {
  try {
    const html = await vscode.commands.executeCommand<unknown>("markdown.api.render", text);
    return typeof html === "string" ? html : undefined;
  } catch {
    return undefined;
  }
}
