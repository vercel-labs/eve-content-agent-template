import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for the deterministic unit suite under `tests/`.
 *
 * @remarks
 * The suite imports the authored definitions under `agent/` directly and calls their `execute`
 * functions, schemas, and policies in process: no eve server, no model, and no network. Tests
 * live outside `agent/` because eve derives tool and capability names from the files it finds
 * there. `tests/setup.ts` clears the environment variables the agent reads and makes any
 * accidental `fetch` fail the test that made it.
 *
 * Mock implementations and call history are reset before every test (`mockReset`), and
 * environment and global stubs are undone after it, so no test can leak state into another,
 * whatever order they run in.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
    setupFiles: ["tests/setup.ts"],
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
