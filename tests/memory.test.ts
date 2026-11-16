import type { MemoryScopeContext } from "eve/memory";
import { describe, expect, it } from "vitest";
import preferences from "#memory/preferences.js";

/**
 * Build the part of a memory scope context the resolver reads.
 *
 * @param current - The session's resolved principal, or `null` when there is none.
 * @returns A scope context carrying only `session.auth.current`.
 */
const scopeContext = (current: Record<string, unknown> | null) =>
  ({ session: { auth: { current } } }) as unknown as MemoryScopeContext;

/**
 * Build a signed-in Slack writer.
 *
 * @param principalId - The writer's Slack user id.
 * @param issuer - The Slack workspace the writer belongs to.
 * @returns The principal eve's Slack auth resolves for that writer.
 */
const writer = (principalId: string, issuer = "T-acme") => ({
  attributes: {},
  authenticator: "slack",
  issuer,
  principalId,
  principalType: "user",
});

describe("preferences memory scope", () => {
  it("gives a signed-in writer a scope", () => {
    expect(preferences.scope(scopeContext(writer("U1")))).not.toBeNull();
  });

  it("is stable for the same writer", () => {
    expect(preferences.scope(scopeContext(writer("U1")))).toEqual(
      preferences.scope(scopeContext(writer("U1")))
    );
  });

  it("separates writers, and the same user id in another workspace", () => {
    const alice = preferences.scope(scopeContext(writer("U1")));
    expect(preferences.scope(scopeContext(writer("U2")))).not.toEqual(alice);
    expect(
      preferences.scope(scopeContext(writer("U1", "T-other")))
    ).not.toEqual(alice);
  });

  it.each(["app", "service", "local-dev", "anonymous"])(
    "gives a %s principal no memory",
    (principalType) => {
      expect(
        preferences.scope(scopeContext({ ...writer("svc"), principalType }))
      ).toBeNull();
    }
  );

  it("gives an unauthenticated session no memory", () => {
    expect(preferences.scope(scopeContext(null))).toBeNull();
  });

  it("describes what belongs in memory", () => {
    expect(preferences.description).toContain("preferences");
  });
});
