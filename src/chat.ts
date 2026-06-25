import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as vscode from "vscode";
import { binaryPath, spawnStreaming, workspaceDir } from "./cli";

// ChatEvent NDJSON shapes — mirror the events emitted by
// `ctxloom run --structured --format json` (one JSON object per stdout line),
// discriminated by `type`: "entry" (conversation content), "complete" (a
// response's completion + accounting), or "session" (one-time session info).
interface ChatEntry {
  type?: string;
  content?: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  isError?: boolean;
}
interface ChatComplete {
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
interface ChatSessionInfo {
  model?: string;
  permissionMode?: string;
  contextWindow?: number;
  mcpServers?: { name?: string; status?: string }[];
}
interface ChatEventLine {
  type?: "entry" | "complete" | "session";
  entry?: ChatEntry;
  complete?: ChatComplete;
  session?: ChatSessionInfo;
}

// Messages the extension posts to the webview.
type ToWebview =
  | { kind: "entry"; entry: ChatEntry }
  | { kind: "complete"; complete: ChatComplete }
  | { kind: "session"; session: ChatSessionInfo }
  | { kind: "status"; text: string; connected: boolean };

// Messages the webview posts back.
type FromWebview = { kind: "send"; text: string };

/**
 * A live chat session: owns a `ctxloom run --structured --format json`
 * subprocess paired with a webview panel. User input flows webview → stdin (one
 * line per message); the agent's structured turns flow stdout (NDJSON) → webview
 * as chat bubbles. It is the GUI sibling of the terminal `run --structured`
 * REPL, driving the same backend.
 *
 * One panel is reused (a singleton): opening chat again reveals the existing one.
 */
export class ChatSession {
  private static current: ChatSession | undefined;

  /** Opens the chat panel, or reveals it if one already exists. */
  static open(context: vscode.ExtensionContext): void {
    if (ChatSession.current) {
      ChatSession.current.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    if (!workspaceDir()) {
      void vscode.window.showErrorMessage(
        "ctxloom: open a folder before starting a chat.",
      );
      return;
    }
    ChatSession.current = new ChatSession(context);
  }

  private readonly panel: vscode.WebviewPanel;
  private proc: ChildProcessWithoutNullStreams | undefined;
  private stdoutBuf = "";
  // Rolling tail of the subprocess's stderr. The backend reports real failures
  // here (e.g. "unknown flag: --structured", "warning: watch stream ended"),
  // so on a non-zero/early exit we can show the cause instead of a bare
  // "session ended". Capped so a chatty -vvv run can't grow it unbounded.
  private stderrTail = "";
  private disposed = false;

  private constructor(context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      "ctxloom.chat",
      "ctxloom chat",
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = chatHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: FromWebview) => this.onWebviewMessage(msg),
      undefined,
      context.subscriptions,
    );
    this.panel.onDidDispose(() => this.dispose(), undefined, context.subscriptions);

    this.start();
  }

  /** Spawns the structured run and wires its streams to the webview. */
  private start(): void {
    const profile = vscode.workspace
      .getConfiguration("ctxloom")
      .get<string>("runProfile");
    const args = ["run", "--structured", "--format", "json"];
    if (profile && profile.trim() !== "") {
      args.push("-p", profile.trim());
    }

    // Pre-flight an absolute binaryPath so a wrong/whitespaced path produces a
    // clear, quoted message rather than a bare async ENOENT. A bare name
    // (PATH lookup) can't be stat-checked here, so it's left to spawn.
    const bin = binaryPath();
    if (isAbsolute(bin) && !existsSync(bin)) {
      this.post({
        kind: "status",
        text: `ctxloom binary not found at "${bin}" — fix the ctxloom.binaryPath setting (check for a stray space)`,
        connected: false,
      });
      return;
    }

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawnStreaming(args);
    } catch (err) {
      this.post({
        kind: "status",
        text: `failed to start ctxloom: ${String(err)}`,
        connected: false,
      });
      return;
    }
    this.proc = proc;
    this.post({ kind: "status", text: "starting agent…", connected: true });

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    // Backend diagnostics ("ctxloom: starting session …") ride stderr; surface
    // them to the output channel rather than the chat transcript.
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      console.error("ctxloom chat:", chunk);
      // Keep the last ~4KB so an early exit can surface the backend's own error.
      this.stderrTail = (this.stderrTail + chunk).slice(-4096);
    });

    proc.on("error", (err) =>
      this.post({
        kind: "status",
        text: `agent process error (binary "${bin}"): ${err.message}`,
        connected: false,
      }),
    );
    proc.on("exit", (code, signal) => {
      this.proc = undefined;
      if (this.disposed) {
        return;
      }
      // Distinguish a clean end from a failure, and attach the backend's last
      // stderr so a misconfigured binary or backend error is diagnosable from
      // the panel rather than appearing as an opaque "session ended".
      const how =
        signal != null
          ? `killed by ${signal}`
          : code === 0
            ? "session ended"
            : `session ended (exit ${code ?? "?"})`;
      const detail = this.lastStderrLine();
      this.post({
        kind: "status",
        text: detail ? `${how} — ${detail}` : how,
        connected: false,
      });
    });
  }

  /** Buffers stdout and dispatches each complete NDJSON line. */
  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk;
    for (let nl = this.stdoutBuf.indexOf("\n"); nl >= 0; nl = this.stdoutBuf.indexOf("\n")) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (line) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string): void {
    let ev: ChatEventLine;
    try {
      ev = JSON.parse(line) as ChatEventLine;
    } catch {
      return; // ignore any non-JSON noise that reaches stdout
    }
    if (ev.entry) {
      this.post({ kind: "entry", entry: ev.entry });
    } else if (ev.complete) {
      this.post({ kind: "complete", complete: ev.complete });
    } else if (ev.session) {
      this.post({ kind: "session", session: ev.session });
    }
  }

  private onWebviewMessage(msg: FromWebview): void {
    if (msg.kind !== "send") {
      return;
    }
    if (!this.proc) {
      this.post({ kind: "status", text: "session ended — reopen chat", connected: false });
      return;
    }
    // One line = one message. Escape backslashes then newlines so a multi-line
    // compose arrives as a single line the backend decodes back (decodeMessageLine
    // turns \\ → \ and \n → newline).
    const wire = msg.text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
    this.proc.stdin.write(wire + "\n");
  }

  /** The most recent non-empty stderr line, for one-line failure context. */
  private lastStderrLine(): string {
    const lines = this.stderrTail
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    return lines.at(-1) ?? "";
  }

  private post(msg: ToWebview): void {
    void this.panel.webview.postMessage(msg);
  }

  private dispose(): void {
    this.disposed = true;
    this.proc?.stdin.end();
    this.proc?.kill();
    this.proc = undefined;
    ChatSession.current = undefined;
  }
}

/** Builds the chat webview HTML with a CSP locked to a per-load nonce. */
function chatHtml(): string {
  const nonce = makeNonce();
  const csp = [
    `default-src 'none'`,
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex; flex-direction: column; height: 100vh;
  }
  #log { flex: 1 1 auto; overflow-y: auto; padding: 12px; }
  .turn { margin: 6px 0; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-wrap: break-word; }
  .user { background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-focusBorder); }
  .assistant { background: var(--vscode-editorWidget-background); }
  .system { opacity: 0.75; font-style: italic; }
  .tool { font-family: var(--vscode-editor-font-family); font-size: 0.9em; opacity: 0.85; }
  .tool.err { color: var(--vscode-errorForeground); }
  .role { font-size: 0.75em; text-transform: uppercase; opacity: 0.6; margin-bottom: 2px; }
  .boundary { border-top: 1px solid var(--vscode-panel-border); margin: 12px 0; }
  #header { padding: 4px 12px; font-size: 0.8em; opacity: 0.8; border-bottom: 1px solid var(--vscode-panel-border); }
  #header:empty { display: none; }
  #meta { padding: 4px 12px; font-size: 0.8em; opacity: 0.7; font-family: var(--vscode-editor-font-family); }
  #meta:empty { display: none; }
  #status { padding: 4px 12px; font-size: 0.8em; opacity: 0.7; border-top: 1px solid var(--vscode-panel-border); }
  #composer { display: flex; padding: 8px; gap: 8px; border-top: 1px solid var(--vscode-panel-border); }
  #input {
    flex: 1 1 auto; resize: none; min-height: 2.4em; max-height: 12em;
    font-family: inherit; font-size: inherit;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 4px; padding: 6px;
  }
  #send {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none; border-radius: 4px; padding: 0 14px; cursor: pointer;
  }
  #send:hover { background: var(--vscode-button-hoverBackground); }
  #send:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
  <div id="header"></div>
  <div id="log"></div>
  <div id="meta"></div>
  <div id="status">connecting…</div>
  <div id="composer">
    <textarea id="input" rows="1" placeholder="Message the agent — Enter to send, Shift+Enter for a new line"></textarea>
    <button id="send">Send</button>
  </div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const header = document.getElementById('header');
  const log = document.getElementById('log');
  const meta = document.getElementById('meta');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const status = document.getElementById('status');

  function scroll() { log.scrollTop = log.scrollHeight; }

  function addTurn(entry) {
    const type = entry.type || 'assistant';
    const div = document.createElement('div');
    if (type === 'tool_use') {
      div.className = 'turn tool';
      div.textContent = '→ ' + (entry.toolName || 'tool');
    } else if (type === 'tool_result') {
      div.className = 'turn tool' + (entry.isError ? ' err' : '');
      div.textContent = (entry.isError ? '✗ ' : '✓ ') + (entry.toolName || 'tool');
    } else {
      div.className = 'turn ' + type;
      const role = document.createElement('div');
      role.className = 'role';
      role.textContent = type;
      div.appendChild(role);
      const body = document.createElement('div');
      body.textContent = entry.content || '';
      div.appendChild(body);
    }
    log.appendChild(div);
    scroll();
  }

  function fmtCount(n) {
    if (!n) return '0';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  // A completed response: rule off the turn and refresh the persistent context
  // gauge / cost / timing bar from the turn's accounting.
  function addComplete(c) {
    const hr = document.createElement('div');
    hr.className = 'boundary';
    log.appendChild(hr);
    scroll();
    const parts = [];
    if (c.contextWindow) parts.push('context ' + fmtCount(c.inputTokens || 0) + '/' + fmtCount(c.contextWindow));
    if (typeof c.costUsd === 'number') parts.push('$' + c.costUsd.toFixed(4));
    if (c.durationMs) parts.push((c.durationMs / 1000).toFixed(1) + 's');
    if (c.model) parts.push(c.model);
    meta.textContent = parts.join(' · ');
  }

  // One-time session info: model + MCP server statuses in the header.
  function setSession(s) {
    const mcp = (s.mcpServers || []).map((m) => m.name + '(' + m.status + ')').join(', ');
    header.textContent = (s.model || '') + (mcp ? ' · mcp: ' + mcp : '');
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.kind === 'entry') addTurn(msg.entry);
    else if (msg.kind === 'complete') addComplete(msg.complete);
    else if (msg.kind === 'session') setSession(msg.session);
    else if (msg.kind === 'status') {
      status.textContent = msg.text;
      send.disabled = !msg.connected;
      input.disabled = !msg.connected;
    }
  });

  function submit() {
    const text = input.value;
    if (!text.trim() || send.disabled) return;
    // Echo the user's message locally; the backend's transcript will also carry
    // it, but immediate feedback matters more than dedupe here.
    addTurn({ type: 'user', content: text });
    vscode.postMessage({ kind: 'send', text });
    input.value = '';
    autosize();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 192) + 'px';
  }

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  send.addEventListener('click', submit);
</script>
</body>
</html>`;
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
