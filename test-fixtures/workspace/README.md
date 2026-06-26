# Integration test workspace

An empty folder opened as the workspace when the `@vscode/test-electron` suite
runs, so the extension activates with a workspace folder present (the chat and
workspace-scoped settings need one). Intentionally has no `.ctxloom/` — the
data-backed views must degrade gracefully when nothing is configured.
