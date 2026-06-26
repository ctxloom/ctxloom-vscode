import { defineConfig } from "@vscode/test-cli";

// Launches a real (headless) VS Code, loads the built extension (dist/), and runs
// the compiled integration suite (out/integration). A workspace folder is opened
// so features that require one (the chat, workspace-scoped settings) behave like
// a real session.
export default defineConfig({
  files: "out/integration/**/*.test.js",
  workspaceFolder: "./test-fixtures/workspace",
  mocha: {
    ui: "bdd",
    timeout: 60000,
  },
});
