import { describe, expect, it } from "vitest";
import { REVIEW_SCHEMA } from "#lib/review-schema.js";
import research from "#tools/research.js";
import review from "#tools/review.js";
import { acceptsInput, callTool, validate } from "../helpers/tool.js";
import {
  cancelled,
  completed,
  failed,
  fakeWorkflowContext,
} from "../helpers/workflow-context.js";

const FINDINGS = {
  findings: [
    {
      claim: "QUIC recovers lost packets per stream.",
      confidence: "high",
      notes: "RFC 9002.",
      sources: [
        { title: "RFC 9002", url: "https://www.rfc-editor.org/rfc/rfc9002" },
      ],
    },
  ],
  gaps: ["No 2026 deployment figures found."],
  summary: "QUIC handles loss per stream.",
} as const;

describe("research", () => {
  it("sends the message to the researcher and returns its findings", async () => {
    const { calls, controller, ctx } = fakeWorkflowContext(() =>
      completed(FINDINGS)
    );

    const output = await callTool(
      research,
      { message: "How does QUIC handle loss?" },
      ctx
    );

    expect(output).toEqual(FINDINGS);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("researcher");
    expect(calls[0]?.message).toBe("How does QUIC handle loss?");
    expect(calls[0]?.options?.outputSchema).toBe(research.outputSchema);
    expect(calls[0]?.options?.signal).toBe(controller.signal);
  });

  it.each(["quick", "standard", "deep"] as const)(
    "prefixes the %s depth as the router's signal",
    async (depth) => {
      const { calls, ctx } = fakeWorkflowContext(() => completed(FINDINGS));

      await callTool(
        research,
        { depth, message: "How does QUIC handle loss?" },
        ctx
      );

      expect(calls[0]?.message).toBe(
        `Research depth: ${depth}\n\nHow does QUIC handle loss?`
      );
    }
  );

  it("fails the call when the researcher fails or stops early", async () => {
    const failing = fakeWorkflowContext(() => failed("search unavailable"));
    await expect(
      callTool(research, { message: "Q" }, failing.ctx)
    ).rejects.toThrow("The researcher failed: search unavailable");

    const stopped = fakeWorkflowContext(() => cancelled());
    await expect(
      callTool(research, { message: "Q" }, stopped.ctx)
    ).rejects.toThrow("The researcher stopped before returning a result.");
  });

  it("bounds the message to 1-15,000 characters", async () => {
    const accepts = (message: string) => acceptsInput(research, { message });
    expect(await accepts("")).toBe(false);
    expect(await accepts("x".repeat(15_000))).toBe(true);
    expect(await accepts("x".repeat(15_001))).toBe(false);
  });

  it("accepts only the known depths", async () => {
    expect(await acceptsInput(research, { depth: "deep", message: "Q" })).toBe(
      true
    );
    expect(
      await acceptsInput(research, { depth: "exhaustive", message: "Q" })
    ).toBe(false);
  });

  it("requires every finding to carry at least one source", async () => {
    const unsourced = {
      ...FINDINGS,
      findings: [{ ...FINDINGS.findings[0], sources: [] }],
    };
    expect((await validate(research.outputSchema, FINDINGS)).ok).toBe(true);
    expect((await validate(research.outputSchema, unsourced)).ok).toBe(false);
  });
});

describe("review", () => {
  it("sends the message to the reviewer and returns its verdict", async () => {
    const verdict = { issues: [], verdict: "ready" } as const;
    const { calls, controller, ctx } = fakeWorkflowContext(() =>
      completed(verdict)
    );
    const message = "Surface: blog\n\nDraft:\nExport reports in one click.";

    const output = await callTool(review, { message }, ctx);

    expect(output).toEqual(verdict);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("reviewer");
    expect(calls[0]?.message).toBe(message);
    expect(calls[0]?.options?.outputSchema).toBe(REVIEW_SCHEMA);
    expect(calls[0]?.options?.signal).toBe(controller.signal);
  });

  it("fails the call when the reviewer fails", async () => {
    const { ctx } = fakeWorkflowContext(() => failed("model overloaded"));

    await expect(
      callTool(review, { message: "Surface: x" }, ctx)
    ).rejects.toThrow("The reviewer failed: model overloaded");
  });

  it("requires a non-empty message", async () => {
    expect(await acceptsInput(review, { message: "" })).toBe(false);
    expect(await acceptsInput(review, {})).toBe(false);
  });
});

describe("REVIEW_SCHEMA", () => {
  it("accepts a verdict with well-formed issues", () => {
    expect(
      REVIEW_SCHEMA.safeParse({
        issues: [{ fix: "f", quote: "q", rule: "r", severity: "high" }],
        verdict: "revise",
      }).success
    ).toBe(true);
  });

  it("rejects unknown verdicts, unknown severities, and missing fields", () => {
    expect(
      REVIEW_SCHEMA.safeParse({ issues: [], verdict: "maybe" }).success
    ).toBe(false);
    expect(
      REVIEW_SCHEMA.safeParse({
        issues: [{ fix: "f", quote: "q", rule: "r", severity: "critical" }],
        verdict: "revise",
      }).success
    ).toBe(false);
    expect(REVIEW_SCHEMA.safeParse({ verdict: "ready" }).success).toBe(false);
  });
});
