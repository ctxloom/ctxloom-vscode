import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

/** Companion tools ctxloom expects on PATH but never installs itself. */
const COMPANIONS = [
  { bin: "taskloom", purpose: "task tracking" },
  { bin: "ltk", purpose: "pre-tool command guidance" },
] as const;

const INSTALL_HINT =
  "Install via Homebrew (`brew install ctxloom/tap/{taskloom,ltk}`) or the install script. ctxloom does not install binaries itself.";

interface CompanionStatus {
  bin: string;
  purpose: string;
  present: boolean;
}

/**
 * Probes each companion by invoking `<bin> --version`. A spawn failure (ENOENT
 * or non-zero exit) means absent — degrade gracefully, never throw (the
 * extension must stay usable without companions).
 */
async function probe(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function statuses(): Promise<CompanionStatus[]> {
  return Promise.all(
    COMPANIONS.map(async (c) => ({ ...c, present: await probe(c.bin) })),
  );
}

/** Reports companion availability, surfacing guidance only for missing ones. */
export async function checkCompanions(): Promise<void> {
  const results = await statuses();
  const missing = results.filter((r) => !r.present);
  if (missing.length === 0) {
    void vscode.window.showInformationMessage(
      "ctxloom companions present: " + results.map((r) => r.bin).join(", "),
    );
    return;
  }
  const names = missing.map((m) => `${m.bin} (${m.purpose})`).join(", ");
  void vscode.window.showWarningMessage(
    `ctxloom: missing companion(s): ${names}. ${INSTALL_HINT}`,
  );
}

/** Best-effort startup probe: warn once if companions are missing, never block. */
export async function checkCompanionsOnStartup(): Promise<void> {
  try {
    const missing = (await statuses()).filter((r) => !r.present);
    if (missing.length > 0) {
      void vscode.window.showWarningMessage(
        `ctxloom: ${missing.map((m) => m.bin).join(", ")} not found on PATH. ${INSTALL_HINT}`,
      );
    }
  } catch {
    // Probing failed entirely — stay silent on startup; the explicit command
    // surfaces detail on demand.
  }
}
