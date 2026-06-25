import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

/**
 * Resolves the configured ctxloom binary (defaults to `ctxloom` on PATH). The
 * value is trimmed: a stray trailing space/newline (easy to introduce when
 * pasting an absolute path into settings) would otherwise make spawn fail with a
 * confusing ENOENT on a path that visibly looks correct.
 */
export function binaryPath(): string {
  const configured = vscode.workspace
    .getConfiguration("ctxloom")
    .get<string>("binaryPath")
    ?.trim();
  return configured ? configured : "ctxloom";
}

/** The first workspace folder's path, or undefined when no folder is open. */
export function workspaceDir(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Runs a ctxloom subcommand non-interactively and resolves its output. Use for
 * read commands (later: `--json` queries) and probes — never for the agent run,
 * which is interactive and belongs in a terminal (see runInTerminal).
 */
export async function exec(args: string[]): Promise<ExecResult> {
  const { stdout, stderr } = await execFileAsync(binaryPath(), args, {
    cwd: workspaceDir(),
  });
  return { stdout, stderr };
}

/**
 * Spawns a long-lived ctxloom subprocess with piped stdio for streaming, used by
 * the chat webview to drive `run --structured --format json`: it writes user
 * messages to stdin and reads the NDJSON turn stream from stdout. Unlike exec
 * (buffered, one-shot) this stays open for the session's lifetime; unlike
 * runInTerminal it captures stdio rather than rendering a TUI.
 */
export function spawnStreaming(args: string[]): ChildProcessWithoutNullStreams {
  return spawn(binaryPath(), args, {
    cwd: workspaceDir(),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Launches an interactive ctxloom command in a dedicated integrated terminal.
 * The agent is a TUI driven over a pty, so it must run in a real terminal rather
 * than a captured subprocess. Reuses a terminal of the same name if present.
 */
export function runInTerminal(name: string, args: string[]): vscode.Terminal {
  const existing = vscode.window.terminals.find((t) => t.name === name);
  const terminal =
    existing ??
    vscode.window.createTerminal({ name, cwd: workspaceDir() });
  terminal.show();
  terminal.sendText(quoteCommand(binaryPath(), args));
  return terminal;
}

/** Joins a command with minimal shell quoting for terminal.sendText. */
function quoteCommand(bin: string, args: string[]): string {
  return [bin, ...args].map(quoteArg).join(" ");
}

function quoteArg(arg: string): string {
  return /[^A-Za-z0-9_./:@-]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg;
}
