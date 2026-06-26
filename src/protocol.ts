// Pure, vscode-free protocol logic shared by the chat panel and the terminal
// run command. Everything here is unit-tested (protocol.test.ts); the
// vscode-dependent wiring lives in chat.ts / run.ts / cli.ts.

// ChatEvent NDJSON shapes — mirror the events emitted by
// `ctxloom run --structured --format json` (one JSON object per stdout line),
// discriminated by which field is present: "entry" (conversation content),
// "complete" (a response's completion + accounting), or "session" (one-time
// session info).
export interface ChatEntry {
  type?: string;
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  isError?: boolean;
  // Optional wire timestamp (RFC3339/ISO). The backend's live chat stream omits
  // it (claude-code's stream-json carries no per-event time); a transcript-derived
  // entry may carry one. parseChatEvent resolves it (or now()) into `at`.
  timestamp?: string;
  // Display-ready, truncated text the extension fills in for tool entries so the
  // webview can show details without re-implementing formatting. See
  // formatToolInput / truncate.
  toolInputText?: string;
  toolOutputText?: string;
  // Sanitized HTML the extension fills in for prose turns by rendering `content`
  // through VS Code's markdown renderer. When present the webview shows this
  // instead of the raw content text. See wantsMarkdown.
  html?: string;
}
export interface ChatComplete {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  costUsd?: number;
  model?: string;
  stopReason?: string;
  durationMs?: number;
  numTurns?: number;
}
export interface ChatSessionInfo {
  model?: string;
  permissionMode?: string;
  contextWindow?: number;
  mcpServers?: { name?: string; status?: string }[];
}
interface ChatEventLine {
  entry?: ChatEntry;
  complete?: ChatComplete;
  session?: ChatSessionInfo;
}

/**
 * A parsed NDJSON line, ready to forward to the webview. Every event carries
 * `at`: epoch-ms when this event occurred — the entry's wire `timestamp` if the
 * data provided one, else the parse-time clock's now(). The backend's live chat
 * stream has no timestamps (see chat_stream.go), so in practice `at` is the
 * receipt time, which is what a frontend wants for ordering and "thought at HH:MM".
 */
export type WebviewEvent =
  | { kind: "entry"; entry: ChatEntry; at: number }
  | { kind: "complete"; complete: ChatComplete; at: number }
  | { kind: "session"; session: ChatSessionInfo; at: number };

/** Clock seam so parseChatEvent's now() fallback is mockable in tests. */
export type Clock = () => number;

/**
 * Encodes a (possibly multi-line) message as a single wire line the backend's
 * decodeMessageLine reverses: backslashes are doubled first, then newlines
 * become a literal `\n`. Doing it in this order keeps a literal backslash-n in
 * the user's text distinct from a real newline.
 */
export function encodeMessageLine(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
}

/**
 * Parses one NDJSON line into a webview event, or undefined for non-JSON noise
 * and for JSON without a recognized field (e.g. heartbeats). Discriminates on
 * which oneof field is present rather than a `type` tag.
 *
 * Every event is stamped with `at` (epoch ms): an entry's wire `timestamp` when
 * the data carries one, otherwise `now()`. The clock is injected so the fallback
 * is deterministic under test; it defaults to Date.now in production.
 */
export function parseChatEvent(
  line: string,
  now: Clock = () => Date.now(),
): WebviewEvent | undefined {
  let ev: ChatEventLine;
  try {
    ev = JSON.parse(line) as ChatEventLine;
  } catch {
    return undefined;
  }
  if (ev.entry) {
    return { kind: "entry", entry: ev.entry, at: resolveTimestamp(ev.entry.timestamp, now) };
  }
  if (ev.complete) {
    return { kind: "complete", complete: ev.complete, at: now() };
  }
  if (ev.session) {
    return { kind: "session", session: ev.session, at: now() };
  }
  return undefined;
}

/**
 * Resolves a wire timestamp to epoch ms: the parsed `timestamp` when present and
 * valid, else the injected clock's now(). Keeps "if it's not in the data, use
 * now" in one place so both the value and the fallback are unit-testable.
 */
function resolveTimestamp(wire: string | undefined, now: Clock): number {
  if (wire) {
    const t = Date.parse(wire);
    if (!Number.isNaN(t)) {
      return t;
    }
  }
  return now();
}

/**
 * Renders a tool's input (an arbitrary JSON value) as display text: strings
 * pass through, objects/arrays are pretty-printed JSON, primitives are
 * stringified, and null/undefined become empty. Keeps the chat panel from
 * re-implementing this in untestable webview script.
 */
export function formatToolInput(input: unknown): string {
  if (input === null || input === undefined) {
    return "";
  }
  if (typeof input === "string") {
    return input;
  }
  if (typeof input === "object") {
    return JSON.stringify(input, null, 2);
  }
  return String(input);
}

/** Cuts text to at most max characters, appending an ellipsis when it overflows. */
export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

// Prose turn types whose content reads as markdown. Tool turns carry structured
// detail (handled separately) and thinking turns are usually empty markers, so
// neither is rendered as markdown.
const MARKDOWN_TYPES = new Set(["assistant", "user", "system"]);

/**
 * Whether an entry of this type should have its content rendered as markdown. An
 * absent type defaults to assistant (a prose turn).
 */
export function wantsMarkdown(type: string | undefined): boolean {
  return type === undefined || MARKDOWN_TYPES.has(type);
}

/** The most recent non-empty stderr line, for one-line failure context. */
export function lastStderrLine(tail: string): string {
  const lines = tail
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  return lines.at(-1) ?? "";
}

export interface RunArgsOptions {
  /** Structured NDJSON REPL (the chat path) vs. interactive terminal (run.ts). */
  structured?: boolean;
  /** Profile name for -p; trimmed, ignored when empty. */
  profile?: string;
  /** Start a fresh session instead of resuming. */
  newSession?: boolean;
  /** Resume the named harp session (--session); takes precedence over newSession. */
  session?: string;
}

/**
 * Builds the argv for `ctxloom run`, the single source of truth shared by the
 * chat panel and the terminal run command so the -p / structured flags don't
 * drift between them. `--session` and `--new-session` are mutually exclusive, so
 * a session (resume) wins when both are somehow set.
 */
export function buildRunArgs(opts: RunArgsOptions): string[] {
  const args = ["run"];
  if (opts.structured) {
    args.push("--structured", "--format", "json");
  }
  const profile = opts.profile?.trim();
  if (profile) {
    args.push("-p", profile);
  }
  const session = opts.session?.trim();
  if (session) {
    args.push("--session", session);
  } else if (opts.newSession) {
    args.push("--new-session");
  }
  return args;
}

/**
 * A transport-agnostic outbound queue that never drops messages: lines enqueued
 * before the transport is writable (or while it is temporarily not) are held
 * and flushed in order once it becomes writable. After that, lines write through
 * immediately. This guarantees a user can fire off several messages — even while
 * the agent is mid-turn — and every one reaches the backend in order.
 */
export class OutboundQueue {
  private readonly pending: string[] = [];
  private writable = false;

  constructor(private readonly write: (line: string) => void) {}

  /** Marks the transport writable (or not); becoming writable flushes in order. */
  setWritable(writable: boolean): void {
    this.writable = writable;
    if (writable) {
      this.flush();
    }
  }

  /** Queues a line, delivering it now if writable or holding it otherwise. */
  enqueue(line: string): void {
    this.pending.push(line);
    this.flush();
  }

  /** Number of messages still waiting for a writable transport. */
  get pendingCount(): number {
    return this.pending.length;
  }

  private flush(): void {
    if (!this.writable) {
      return;
    }
    while (this.pending.length > 0) {
      const line = this.pending.shift();
      if (line !== undefined) {
        this.write(line);
      }
    }
  }
}
