// Pure, vscode-free parsing of `ctxloom profile list --format json`. The
// vscode/exec wiring (listProfiles) lives in cli.ts; this is unit-tested.

export interface Profile {
  /** The value passed to `ctxloom run -p` — a short name or a remote reference. */
  name: string;
  /** Short, human label supplied by the backend (e.g. "default" for a remote ref). */
  displayName: string;
  description: string;
  /** True for the project's configured default profile. */
  isDefault: boolean;
  /** True when this is a seeded remote profile reference rather than a local file. */
  isRemote: boolean;
}

interface RawProfile {
  name?: unknown;
  display_name?: unknown;
  description?: unknown;
  default?: unknown;
  is_remote?: unknown;
}

/**
 * Parses the JSON array emitted by `ctxloom profile list --format json` into
 * Profiles. The backend supplies `display_name` and `is_remote`, so the
 * extension no longer parses remote refs itself (it falls back to `name` only if
 * an older binary omits display_name). Entries without a string `name` are
 * skipped. Throws on output that isn't a JSON array so the caller can surface a
 * clear error rather than silently showing an empty picker.
 */
export function parseProfiles(stdout: string): Profile[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("expected a JSON array from `ctxloom profile list --format json`");
  }
  const profiles: Profile[] = [];
  for (const item of parsed) {
    const raw = item as RawProfile;
    if (typeof raw.name !== "string") {
      continue;
    }
    profiles.push({
      name: raw.name,
      displayName: typeof raw.display_name === "string" ? raw.display_name : raw.name,
      description: typeof raw.description === "string" ? raw.description : "",
      isDefault: raw.default === true,
      isRemote: raw.is_remote === true,
    });
  }
  return profiles;
}
