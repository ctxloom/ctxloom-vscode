import { defineConfig } from "vitest/config";

// Unit tests cover the vscode-free pure logic in src/ (protocol parsing, arg
// building, the outbound queue). Modules that import "vscode" are not unit
// tested here — that API only exists in the extension host.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests (src/integration) import the `vscode` module, which only
    // exists in the extension host — they run under @vscode/test-electron
    // (`npm run test:integration`), never vitest.
    exclude: ["src/integration/**", "node_modules/**"],
  },
});
