// Parsing of `ctxloom session list --format json`, plus the transport-backed
// loaders. parseSessions is pure and vscode-free, so it is unit-tested
// (sessions-data.test.ts). The loaders reach the backend only through the
// transport() seam (transport.ts is vscode-free), keeping this module's static
// graph testable and the CLI/gRPC choice swappable.
import { transport } from "./transport";

export interface Session {
  harpName: string;
  sessionId: string;
  backend: string;
  startedAt: string;
  endedAt: string;
}

interface RawSession {
  harp_name?: unknown;
  session_id?: unknown;
  backend?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
}

/** A string field of an unknown record, or "" when it is absent/non-string. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parses the JSON array emitted by `ctxloom session list --format json` into
 * Sessions, mapping snake_case wire fields to camelCase. Entries without a
 * string `harp_name` are skipped (nothing to act on). Throws on output that
 * isn't a JSON array so the caller can surface a clear error rather than
 * silently showing an empty view.
 */
export function parseSessions(stdout: string): Session[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("expected a JSON array from `ctxloom session list --format json`");
  }
  const sessions: Session[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const raw: RawSession = item;
    if (typeof raw.harp_name !== "string") {
      continue;
    }
    sessions.push({
      harpName: raw.harp_name,
      sessionId: str(raw.session_id),
      backend: str(raw.backend),
      startedAt: str(raw.started_at),
      endedAt: str(raw.ended_at),
    });
  }
  return sessions;
}

/** Lists recorded sessions via the cli seam, newest-first as ctxloom emits them. */
export async function listSessions(): Promise<Session[]> {
  const { stdout } = await transport().exec(["session", "list", "--format", "json"]);
  return parseSessions(stdout);
}

interface RawEssence {
  distilled?: unknown;
  essence?: unknown;
}

/**
 * Parses `session show --format json` output ({harp, distilled, essence}) into
 * the essence markdown, or undefined when the session isn't distilled yet. The
 * backend returns distilled:false with an empty essence (not an error) in that
 * case, so the view can show a "not distilled" hint without catching exit codes.
 */
export function parseSessionEssence(stdout: string): string | undefined {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const raw: RawEssence = parsed;
  if (raw.distilled === true && typeof raw.essence === "string" && raw.essence !== "") {
    return raw.essence;
  }
  return undefined;
}

/**
 * Fetches a session's distilled essence (markdown) via
 * `ctxloom session show --format json`. Returns undefined when the session isn't
 * distilled yet or the command fails, so the view falls back to a "not distilled"
 * hint instead of surfacing an error.
 */
export async function sessionEssence(harp: string): Promise<string | undefined> {
  try {
    const { stdout } = await transport().exec(["session", "show", harp, "--format", "json"]);
    return parseSessionEssence(stdout);
  } catch {
    return undefined;
  }
}
