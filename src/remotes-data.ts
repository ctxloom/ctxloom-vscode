// Parsing of `ctxloom remote list --format json`, plus the transport-backed
// loader. parseRemotes is pure and vscode-free, so it is unit-tested
// (remotes-data.test.ts). The loader reaches the backend only through the
// transport() seam (transport.ts is vscode-free), keeping this module's static
// graph testable and the CLI/gRPC choice swappable.
import { transport } from "./transport";

export interface Remote {
  /** The registry name, e.g. `ctxloom-default` — what add/pull/trust act on. */
  name: string;
  /** The remote's git/GitHub URL. */
  url: string;
  /**
   * True for the project's configured default remote. The `remote list` JSON
   * does not currently surface which remote is default (there is a separate
   * `remote default <name>` subcommand), so this is false in practice; kept so
   * the field exists if the CLI starts emitting it.
   */
  isDefault: boolean;
  /** True when the remote is trusted (bundle changes auto-apply). */
  trusted?: boolean;
}

interface RawRemote {
  name?: unknown;
  url?: unknown;
  default?: unknown;
  trusted?: unknown;
}

interface RawRemoteList {
  remotes?: unknown;
}

/** A string field of an unknown value, or "" when it is absent/non-string. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parses the JSON object emitted by `ctxloom remote list --format json` into
 * Remotes. The wire shape is `{ "remotes": [{ name, url, trusted }], count }`.
 * Entries without a string `name` are skipped (nothing to act on). Throws when
 * the output isn't an object with a `remotes` array so the caller can surface a
 * clear error rather than silently showing an empty view.
 */
export function parseRemotes(stdout: string): Remote[] {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("expected a JSON object from `ctxloom remote list --format json`");
  }
  const top: RawRemoteList = parsed;
  if (!Array.isArray(top.remotes)) {
    throw new Error("expected a `remotes` array from `ctxloom remote list --format json`");
  }
  const remotes: Remote[] = [];
  for (const item of top.remotes) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const raw: RawRemote = item;
    if (typeof raw.name !== "string") {
      continue;
    }
    const remote: Remote = {
      name: raw.name,
      url: str(raw.url),
      isDefault: raw.default === true,
    };
    if (typeof raw.trusted === "boolean") {
      remote.trusted = raw.trusted;
    }
    remotes.push(remote);
  }
  return remotes;
}

/** Lists configured remotes via the cli seam, in the order ctxloom emits them. */
export async function listRemotes(): Promise<Remote[]> {
  const { stdout } = await transport().exec(["remote", "list", "--format", "json"]);
  return parseRemotes(stdout);
}
