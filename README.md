# ctxloom — VSCode companion

A VSCode frontend to the same [ctxloom](https://ctxloom.dev) backend as the CLI.
It owns no state of its own: config, sessions, plans, tasks, and bundles are the
project's `.ctxloom/` state, reached by driving the `ctxloom` binary. Anything
you do in the CLI shows up here and vice versa.

## What it does (P0)

- **Run Agent** — launches `ctxloom run` in an integrated terminal (the existing
  TUI). Sessions are written by the backend, identical to a CLI launch.
- **Companion detection** — checks for `taskloom` and `ltk` on PATH and points
  you at install guidance if either is missing. (ctxloom never installs
  binaries.)
- **Status bar** — a ctxloom entry point.

## Settings

- `ctxloom.binaryPath` — path to the `ctxloom` binary (default: `ctxloom`).
- `ctxloom.runProfile` — profile passed to `ctxloom run` via `-p`. Empty uses the
  project's configured default profiles.

## Develop

```bash
npm install
npm run build      # bundle to dist/extension.js
npm run watch      # rebuild on change
npm run check      # type-check only
```

Press F5 in VSCode to launch an Extension Development Host.

## Roadmap

Session-history tree, plans view, full CLI-parity control plane, and a full
taskloom task tree land next (they depend on `--json` read output from the
backend). A native message/chat UI is a later track that needs the backend to
emit a structured turn stream.
