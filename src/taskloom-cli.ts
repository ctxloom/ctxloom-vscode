// The exec seam for the taskloom companion binary — a SEPARATE binary from
// ctxloom, so it does not go through cli.ts/transport.ts. Resolves the configured
// taskloom binary (`ctxloom.taskloomPath`) and runs it in the workspace folder.
// Shared by the Tasks and Plans data layers (tasks-data.ts, plans-data.ts).
//
// vscode is imported lazily (dynamic import) rather than at module top level so
// the pure parsers in those modules stay loadable under vitest, where no
// `vscode` module exists.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as vscode from "vscode";

const execFileAsync = promisify(execFile);

async function vscodeApi(): Promise<typeof vscode> {
  return import("vscode");
}

/**
 * Resolves the configured taskloom binary (defaults to `taskloom` on PATH),
 * trimmed so a stray pasted space/newline doesn't cause a confusing ENOENT.
 * Mirrors cli.ts's binaryPath but for the separate `ctxloom.taskloomPath`.
 */
function taskloomPath(api: typeof vscode): string {
  const configured = api.workspace
    .getConfiguration("ctxloom")
    .get<string>("taskloomPath")
    ?.trim();
  return configured ? configured : "taskloom";
}

/** The first workspace folder's path, or undefined when no folder is open. */
function workspaceDir(api: typeof vscode): string | undefined {
  return api.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Runs a taskloom subcommand non-interactively in the workspace folder and
 * resolves its stdout.
 */
export async function taskloomExec(args: string[]): Promise<string> {
  const api = await vscodeApi();
  const { stdout } = await execFileAsync(taskloomPath(api), args, {
    cwd: workspaceDir(api),
  });
  return stdout;
}
