// Pure + node-only data layer for the ltk (llm-tool-killer) view. ltk is its
// OWN binary (not ctxloom), a pre-tool hook that gates shell commands and file
// edits. This module owns the small execFile wrapper that runs `ltk evaluate`,
// the payload it writes to stdin, and the decision it parses from stdout. The
// vscode-dependent wiring lives in ltk-view.ts.
//
// PROBED against ltk v0.0.4 (`ltk --help`, `ltk evaluate --help`, and live
// runs):
//   - `ltk evaluate` reads a JSON hook payload on stdin describing a tool call.
//     For a shell command the relevant field is `tool_input.command`; the engine
//     adapter defaults to "claude-code", which keys off `tool_name` ("Bash").
//   - On ALLOW it writes nothing to stdout and exits 0.
//   - On DENY (claude-code engine) it writes a single JSON object on stdout,
//     exit 0:
//       {"hookSpecificOutput":{"hookEventName":"PreToolUse",
//         "permissionDecision":"deny",
//         "permissionDecisionReason":"<message>\n\nUse instead: <suggest>"}}
//     i.e. the rule's `message` and (optional) `suggest` are concatenated into
//     one `permissionDecisionReason` string — there is no separate JSON field
//     for the suggestion. parseLtkDecision splits them back out on the
//     "Use instead: " marker, tolerantly.

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

/** Marker ltk's claude-code adapter uses to join the rule message and suggest. */
const SUGGEST_MARKER = "Use instead: ";

/**
 * A normalized allow/deny decision derived from `ltk evaluate` output. `message`
 * and `suggestion` are only present on a deny and are best-effort split out of
 * the engine's single reason string.
 */
export interface LtkDecision {
  allow: boolean;
  message?: string;
  suggestion?: string;
}

/**
 * The claude-code PreToolUse hook output ltk emits on a denial. Shape confirmed
 * against the real binary; all fields optional so a future/altered shape parses
 * tolerantly rather than throwing.
 */
interface HookOutput {
  hookSpecificOutput?: {
    hookEventName?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
  };
}

/**
 * Resolves the configured ltk binary (defaults to `ltk` on PATH). Mirrors
 * cli.ts/binaryPath: the value is trimmed so a stray trailing space/newline
 * pasted into settings doesn't turn into a confusing ENOENT.
 */
export function ltkPath(): string {
  const configured = vscode.workspace
    .getConfiguration("ctxloom")
    .get<string>("ltkPath")
    ?.trim();
  return configured ? configured : "ltk";
}

/** The first workspace folder's path, or undefined when no folder is open. */
export function workspaceDir(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** The project rules file ltk reads: `<workspace>/.ltk/config.yaml`. */
export function ltkConfigPath(workspaceDir: string): string {
  return path.join(workspaceDir, ".ltk", "config.yaml");
}

/**
 * Builds the stdin payload JSON for `ltk evaluate` describing a shell command.
 *
 * Shape (claude-code engine, the ltk default):
 *   { "tool_name": "Bash", "tool_input": { "command": "<command>" } }
 *
 * ltk matches the command from `tool_input.command`; `tool_name` selects the
 * shell-command code path in the engine adapter. If a future ltk changes the
 * expected payload, this single function is the place to fix.
 */
export function buildEvaluatePayload(command: string): string {
  return JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
  });
}

/**
 * Parses `ltk evaluate` stdout into a normalized decision.
 *
 * - Empty/whitespace stdout → allow (ltk writes nothing on allow).
 * - A JSON hook object with permissionDecision "deny" → deny; the
 *   `permissionDecisionReason` is split into message + suggestion on the
 *   "Use instead: " marker the engine inserts.
 * - Any non-deny / unrecognized but non-empty output is treated as allow, so a
 *   silent or unexpected shape never blocks the user (this is advisory UI).
 *
 * Tolerant by design: malformed JSON does not throw.
 */
export function parseLtkDecision(stdout: string): LtkDecision {
  const text = stdout.trim();
  if (text === "") {
    return { allow: true };
  }

  let parsed: HookOutput;
  try {
    parsed = JSON.parse(text) as HookOutput;
  } catch {
    // Unparseable, non-empty output — don't block; surface nothing.
    return { allow: true };
  }

  const out = parsed.hookSpecificOutput;
  if (!out || out.permissionDecision !== "deny") {
    return { allow: true };
  }

  return { allow: false, ...splitReason(out.permissionDecisionReason) };
}

/**
 * Splits ltk's combined reason ("<message>\n\nUse instead: <suggest>") back into
 * its parts. When there's no marker the whole string is the message and there is
 * no suggestion.
 */
function splitReason(reason: string | undefined): {
  message?: string;
  suggestion?: string;
} {
  const full = reason?.trim();
  if (!full) {
    return {};
  }
  const idx = full.indexOf(SUGGEST_MARKER);
  if (idx === -1) {
    return { message: full };
  }
  const message = full.slice(0, idx).trim();
  const suggestion = full.slice(idx + SUGGEST_MARKER.length).trim();
  const result: { message?: string; suggestion?: string } = {};
  if (message) {
    result.message = message;
  }
  if (suggestion) {
    result.suggestion = suggestion;
  }
  return result;
}

/**
 * Runs `ltk evaluate` against a single shell command and resolves the decision.
 * Writes the hook payload to the child's stdin, reads its stdout, and parses it.
 * Resolves to an allow on any spawn/exec failure so a missing or broken ltk
 * never blocks the user — this is advisory ("would ltk deny this?") UI.
 */
export async function evaluateCommand(command: string): Promise<LtkDecision> {
  const payload = buildEvaluatePayload(command);
  try {
    const child = execFileAsync(ltkPath(), ["evaluate"], {
      cwd: workspaceDir(),
    });
    child.child.stdin?.end(payload);
    const { stdout } = await child;
    return parseLtkDecision(stdout);
  } catch {
    return { allow: true };
  }
}
