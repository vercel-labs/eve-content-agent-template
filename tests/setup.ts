import { beforeEach, vi } from "vitest";

/**
 * Environment variables the files under `agent/` read when they load.
 *
 * @remarks
 * Cleared before any test file is imported, so the suite gives the same result whatever the
 * shell has set: a leftover `EVE_MOCK_MODEL=1` from `pnpm eval:offline`, the connector UIDs from
 * `vercel env pull`, or the variables that mark a development server. A test that needs one sets
 * it with `vi.stubEnv` and, for a value read at module load, re-imports the module.
 */
const AMBIENT_VARIABLES = [
  "EVE_DEV",
  "EVE_MOCK_MODEL",
  "NOTION_CONNECTOR",
  "SLACK_CONNECTOR",
  "VERCEL",
  "VERCEL_ENV",
] as const;

for (const name of AMBIENT_VARIABLES) {
  Reflect.deleteProperty(process.env, name);
}

/**
 * Fail any test that reaches for the network.
 *
 * @remarks
 * The suite is deterministic: Blob, the decision model, and subagents are replaced by fakes in
 * the tests that need them. A code path that slips past a fake and calls `fetch` rejects here
 * instead of making a real request, so the failure names the URL that leaked.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", (input: unknown) =>
    Promise.reject(
      new Error(`Network access is disabled in unit tests: ${String(input)}`)
    )
  );
});
