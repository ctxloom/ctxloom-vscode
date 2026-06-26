import type { ChildProcessWithoutNullStreams } from "node:child_process";

/** Result of a non-interactive ctxloom command. */
export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * The single seam between the extension and the ctxloom backend.
 *
 * Today this is the CLI — `cli.ts` provides a child-process implementation and
 * registers it at activation. It is deliberately an interface, and ALL backend
 * access (every data module, the chat) goes through the active instance via
 * `transport()`, so the CLI can be swapped for a gRPC-backed implementation by
 * registering a different one — with no call-site changes.
 *
 * This module is vscode-free on purpose: data modules import it (not `cli.ts`,
 * which pulls in vscode), keeping their static graph testable under vitest and
 * letting tests inject a fake transport.
 *
 * `spawnStreaming` is the one CLI-shaped method (it hands back a child process
 * for the structured chat REPL); a gRPC transport would back it with an adapter
 * exposing the same duplex over a streaming RPC.
 */
export interface CtxloomTransport {
  /** Run a ctxloom subcommand non-interactively, resolving its stdout/stderr. */
  exec(args: string[]): Promise<ExecResult>;
  /** Start a long-lived streaming subprocess (the structured chat REPL). */
  spawnStreaming(args: string[]): ChildProcessWithoutNullStreams;
}

let active: CtxloomTransport | undefined;

/**
 * Registers the active transport. Called once at activation by the CLI impl; a
 * future gRPC impl (or a test fake) can install its own instead.
 */
export function setTransport(impl: CtxloomTransport): void {
  active = impl;
}

/** The active transport. Throws if none has been registered yet. */
export function transport(): CtxloomTransport {
  if (active === undefined) {
    throw new Error(
      "ctxloom transport not initialized (cli.ts registers it at activation)",
    );
  }
  return active;
}
