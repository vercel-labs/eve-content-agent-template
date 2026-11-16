import { decide } from "eve/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BANNED_WORDS } from "#lib/banned-words.generated.js";
import { DECISION_MODEL } from "#lib/models.js";
import { REVIEW_SCHEMA } from "#lib/review-schema.js";
import { REVIEWER_RUBRIC } from "#subagents/reviewer/lib/rubric.generated.js";
import checkStyle from "#tools/check_style.js";
import { acceptsInput, callTool } from "../helpers/tool.js";
import {
  completed,
  failed,
  fakeWorkflowContext,
} from "../helpers/workflow-context.js";

vi.mock("eve/ai", () => ({ decide: vi.fn() }));

const RULES = [
  "avoidsAiPhrasing",
  "fitsFormatSpecs",
  "followsBestPractices",
  "usesPlainEnglish",
] as const;

const CLEAN = "Export reports in one click.";

/**
 * A blog draft that uses every word the blog skill bans, whatever the list holds today.
 */
const BANNED_DRAFT = `Draft: ${BANNED_WORDS.blog.join(", ")}.`;
const BANNED_VIOLATIONS = BANNED_WORDS.blog.map(
  (word) => `Avoid "${word}" per the blog style guide.`
);
const READY = { issues: [], verdict: "ready" } as const;
const REVISE = {
  issues: [
    {
      fix: "Say what changed.",
      quote: "one click",
      rule: "Be specific",
      severity: "medium",
    },
  ],
  verdict: "revise",
} as const;

/**
 * Make the mocked decision model answer every rule, with overrides for some.
 *
 * @param overrides - Probabilities for specific rules; the rest get `fallback`.
 * @param fallback - Probability for every rule not overridden.
 */
const decideAnswers = (
  overrides: Partial<Record<(typeof RULES)[number], number>> = {},
  fallback = 0.95
): void => {
  vi.mocked(decide).mockResolvedValue({
    answers: Object.fromEntries(
      RULES.map((rule) => [
        rule,
        { probability: overrides[rule] ?? fallback, type: "boolean" },
      ])
    ),
    usage: {
      inputTokens: undefined,
      outputTokens: undefined,
      totalTokens: undefined,
    },
  } as never);
};

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("check_style: confident decisions", () => {
  it("passes a clean draft when every rule clears the threshold", async () => {
    decideAnswers();
    const { calls, ctx } = fakeWorkflowContext();

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: CLEAN },
      ctx
    );

    expect(output).toEqual({
      checks: RULES.map((rule) => ({ passed: true, probability: 0.95, rule })),
      escalation: "none",
      ok: true,
      violations: [],
    });
    expect(calls).toEqual([]);
  });

  it("asks the decision model each rule about the draft and the surface's rubric", async () => {
    decideAnswers();
    const { controller, ctx } = fakeWorkflowContext();

    await callTool(checkStyle, { surface: "linkedin", text: CLEAN }, ctx);

    expect(decide).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(decide).mock.calls[0] ?? [];
    expect(options?.model).toBe(DECISION_MODEL);
    expect(options?.signal).toBe(controller.signal);
    expect(Object.keys(options?.questions ?? {}).sort()).toEqual([...RULES]);
    for (const question of Object.values(options?.questions ?? {})) {
      expect(question.type).toBe("boolean");
    }
    expect(options?.state).toEqual({
      draft: CLEAN,
      rubric: {
        ...REVIEWER_RUBRIC.house,
        ...REVIEWER_RUBRIC.surfaces.linkedin,
      },
      surface: "linkedin",
    });
  });

  it("fails a draft on a confident rule failure without asking the reviewer", async () => {
    decideAnswers({ usesPlainEnglish: 0.1 });
    const { calls, ctx } = fakeWorkflowContext();

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: CLEAN },
      ctx
    );

    expect(output.escalation).toBe("none");
    expect(output.ok).toBe(false);
    expect(output.review).toBeUndefined();
    expect(output.checks.filter((check) => !check.passed)).toEqual([
      { passed: false, probability: 0.1, rule: "usesPlainEnglish" },
    ]);
    expect(calls).toEqual([]);
  });

  it("reports banned words and fails even when every rule passes", async () => {
    decideAnswers();
    const { ctx } = fakeWorkflowContext();

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: BANNED_DRAFT },
      ctx
    );

    expect(output.violations).toEqual(BANNED_VIOLATIONS);
    expect(output.violations.length).toBeGreaterThan(0);
    expect(output.ok).toBe(false);
    expect(output.escalation).toBe("none");
  });
});

describe("check_style: the uncertain band", () => {
  it.each([
    { escalates: false, passed: false, probability: 0 },
    { escalates: false, passed: false, probability: 0.25 },
    { escalates: true, passed: false, probability: 0.250_001 },
    { escalates: true, passed: false, probability: 0.5 },
    { escalates: true, passed: false, probability: 0.75 },
    { escalates: false, passed: true, probability: 0.750_001 },
    { escalates: false, passed: true, probability: 1 },
  ])(
    "probability $probability: escalates=$escalates, passed=$passed",
    async ({ escalates, passed, probability }) => {
      decideAnswers({ fitsFormatSpecs: probability });
      const { calls, ctx } = fakeWorkflowContext(() => completed(READY));

      const output = await callTool(
        checkStyle,
        { surface: "blog", text: CLEAN },
        ctx
      );

      expect(output.escalation).toBe(escalates ? "uncertain" : "none");
      expect(calls).toHaveLength(escalates ? 1 : 0);
      expect(
        output.checks.find((check) => check.rule === "fitsFormatSpecs")?.passed
      ).toBe(passed);
    }
  );
});

describe("check_style: reviewer fallback", () => {
  it("sends the surface and draft to the reviewer when a rule is too close to call", async () => {
    decideAnswers({ followsBestPractices: 0.5 });
    const { calls, controller, ctx } = fakeWorkflowContext(() =>
      completed(READY)
    );

    const output = await callTool(
      checkStyle,
      { surface: "x", text: CLEAN },
      ctx
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("reviewer");
    expect(calls[0]?.message).toBe(`Surface: x\n\nDraft:\n${CLEAN}`);
    expect(calls[0]?.options?.outputSchema).toBe(REVIEW_SCHEMA);
    expect(calls[0]?.options?.signal).toBe(controller.signal);
    expect(output).toMatchObject({
      escalation: "uncertain",
      ok: true,
      review: READY,
      violations: [],
    });
    expect(output.checks).toHaveLength(RULES.length);
  });

  it("lets the reviewer's verdict decide an escalated check", async () => {
    decideAnswers({ followsBestPractices: 0.5 });
    const { ctx } = fakeWorkflowContext(() => completed(REVISE));

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: CLEAN },
      ctx
    );

    expect(output.ok).toBe(false);
    expect(output.review).toEqual(REVISE);
  });

  it("still fails on a banned word when the reviewer says ready", async () => {
    decideAnswers({ followsBestPractices: 0.5 });
    const { ctx } = fakeWorkflowContext(() => completed(READY));

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: BANNED_DRAFT },
      ctx
    );

    expect(output.ok).toBe(false);
    expect(output.violations).toEqual(BANNED_VIOLATIONS);
    expect(output.review).toEqual(READY);
  });

  it("falls back to the reviewer and says so when the decision model fails", async () => {
    vi.mocked(decide).mockRejectedValue(new Error("gateway unavailable"));
    const { calls, ctx } = fakeWorkflowContext(() => completed(READY));

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: CLEAN },
      ctx
    );

    expect(output).toEqual({
      checks: [],
      escalation: "decide_error",
      ok: true,
      review: READY,
      violations: [],
    });
    expect(calls).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("fails the call when the escalated review fails", async () => {
    decideAnswers({ followsBestPractices: 0.5 });
    const { ctx } = fakeWorkflowContext(() => failed("reviewer crashed"));

    await expect(
      callTool(checkStyle, { surface: "blog", text: CLEAN }, ctx)
    ).rejects.toThrow("The reviewer failed: reviewer crashed");
  });
});

describe("check_style: input", () => {
  it("accepts only known surfaces", async () => {
    expect(await acceptsInput(checkStyle, { surface: "blog", text: "x" })).toBe(
      true
    );
    expect(
      await acceptsInput(checkStyle, { surface: "tiktok", text: "x" })
    ).toBe(false);
    expect(await acceptsInput(checkStyle, { text: "x" })).toBe(false);
  });

  it("bounds the draft to 1-100,000 characters", async () => {
    const accepts = (text: string) =>
      acceptsInput(checkStyle, { surface: "blog", text });
    expect(await accepts("")).toBe(false);
    expect(await accepts("a".repeat(100_000))).toBe(true);
    expect(await accepts("a".repeat(100_001))).toBe(false);
  });
});
