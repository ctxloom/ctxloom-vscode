import * as vscode from "vscode";
import { runInTerminal, workspaceDir } from "./cli";

/**
 * Launches `ctxloom run` in an integrated terminal. The configured runProfile,
 * when set, is passed via -p; otherwise ctxloom uses the project's default
 * profiles. Requires an open workspace folder (the agent runs against a project
 * root).
 */
export function runAgent(): void {
  if (!workspaceDir()) {
    void vscode.window.showErrorMessage(
      "ctxloom: open a folder before running the agent.",
    );
    return;
  }
  const profile = vscode.workspace
    .getConfiguration("ctxloom")
    .get<string>("runProfile");
  const args = ["run"];
  if (profile && profile.trim() !== "") {
    args.push("-p", profile.trim());
  }
  runInTerminal("ctxloom agent", args);
}
