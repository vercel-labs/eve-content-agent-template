import type { DynamicModelContext } from "eve/models";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DECISION_MODEL,
  DEEP_RESEARCH_MODEL,
  STANDARD_RESEARCH_MODEL,
} from "#lib/models.js";
import { SURFACES } from "#lib/surfaces.generated.js";
import researcher from "#subagents/researcher/agent.js";
import checkStyle from "#tools/check_style.js";
import detectSurface from "#tools/detect_surface.js";
import { chooses, fakeDecisionModel, says } from "./helpers/decision-model.js";
import { callTool } from "./helpers/tool.js";
import { toolContext } from "./helpers/tool-context.js";
import { completed, fakeWorkflowContext } from "./helpers/workflow-context.js";

/**
 * These tests run eve's real `decide()` and `auto()` against a fake decision model, so they cover
 * what the mocked-`decide` unit tests can't: that the questions this project builds are ones the
 * AI SDK accepts, and that the answers come back in the shape the tools read.
 */

const CLEAN = "Export reports in one click.";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("detect_surface through eve's decide()", () => {
  it("asks the decision model one choice question over every surface", async () => {
    const requests = fakeDecisionModel((_id, question) =>
      chooses(question, "linkedin", 0.9)
    );

    const output = await callTool(
      detectSurface,
      { request: "Announce the launch to my network." },
      toolContext()
    );

    expect(output).toEqual({
      outcome: "confident",
      probability: 0.9,
      surface: "linkedin",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.modelId).toBe(DECISION_MODEL);
    expect(requests[0]?.state).toContain("Announce the launch to my network.");
    const asked = requests[0]?.questions.surface;
    expect(asked?.type).toBe("choice");
    expect(
      asked?.type === "choice" ? Object.keys(asked.criteria).sort() : []
    ).toEqual([...SURFACES, "not-stated"].sort());
  });

  it("asks the writer when the model's choice is below the threshold", async () => {
    fakeDecisionModel((_id, question) => chooses(question, "blog", 0.6));

    await expect(
      callTool(detectSurface, { request: "Write this up." }, toolContext())
    ).resolves.toEqual({ outcome: "unsure", probability: 0.6, surface: null });
  });

  it("reports decide_error when the decision model fails", async () => {
    fakeDecisionModel(() => {
      throw new Error("decision model unavailable");
    });

    await expect(
      callTool(detectSurface, { request: "Write this up." }, toolContext())
    ).resolves.toEqual({
      outcome: "decide_error",
      probability: null,
      surface: null,
    });
  });
});

describe("check_style through eve's decide()", () => {
  it("asks four yes/no questions and passes a clean, confident draft", async () => {
    const requests = fakeDecisionModel(() => says(0.95));
    const { calls, ctx } = fakeWorkflowContext();

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: CLEAN },
      ctx
    );

    expect(output.escalation).toBe("none");
    expect(output.ok).toBe(true);
    expect(output.checks.map((check) => check.rule).sort()).toEqual([
      "avoidsAiPhrasing",
      "fitsFormatSpecs",
      "followsBestPractices",
      "usesPlainEnglish",
    ]);
    expect(calls).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.modelId).toBe(DECISION_MODEL);
    expect(requests[0]?.state).toContain(CLEAN);
    expect(
      Object.values(requests[0]?.questions ?? {}).map(
        (question) => question.type
      )
    ).toEqual(["boolean", "boolean", "boolean", "boolean"]);
  });

  it("escalates to the reviewer when one answer is too close to call", async () => {
    fakeDecisionModel((id) => says(id === "usesPlainEnglish" ? 0.5 : 0.95));
    const { calls, ctx } = fakeWorkflowContext(() =>
      completed({ issues: [], verdict: "ready" })
    );

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: CLEAN },
      ctx
    );

    expect(output.escalation).toBe("uncertain");
    expect(output.review).toEqual({ issues: [], verdict: "ready" });
    expect(calls.map((call) => call.name)).toEqual(["reviewer"]);
  });

  it("escalates with decide_error when the decision model fails", async () => {
    fakeDecisionModel(() => {
      throw new Error("decision model unavailable");
    });
    const { calls, ctx } = fakeWorkflowContext(() =>
      completed({ issues: [], verdict: "ready" })
    );

    const output = await callTool(
      checkStyle,
      { surface: "blog", text: CLEAN },
      ctx
    );

    expect(output.escalation).toBe("decide_error");
    expect(output.checks).toEqual([]);
    expect(calls.map((call) => call.name)).toEqual(["reviewer"]);
  });
});

/**
 * Run the researcher's model router for one research message.
 *
 * @remarks
 * `auto()` returns an opaque value that only eve evaluates, so this reaches the resolver through
 * the registered symbol eve itself reads. It is the one place the suite depends on something eve
 * doesn't document; if an eve release moves it, this helper fails with the message below.
 *
 * @param message - The message the `research` tool sent to the researcher.
 * @returns The model the router chose for the turn.
 */
const routeResearch = async (message: string): Promise<unknown> => {
  const resolver: unknown = Reflect.get(
    researcher.model as object,
    Symbol.for("eve.dynamic")
  );
  if (typeof resolver !== "function") {
    throw new Error(
      "The researcher's model is no longer an eve dynamic value; update routeResearch."
    );
  }
  const context = {
    memo: (_key: unknown, run: (occurrence: unknown) => unknown) =>
      Promise.resolve(
        run({
          abortSignal: new AbortController().signal,
          idempotencyKey: "test",
        })
      ),
    messages: () => Promise.resolve([{ content: message, role: "user" }]),
    session: { auth: { current: null }, id: "session_test" },
    turn: {
      id: "turn_test",
      input: [{ kind: "text", text: message }],
      status: "running",
    },
  } as unknown as DynamicModelContext;
  return await resolver(context);
};

describe("researcher model routing through eve's auto()", () => {
  it("offers the decision model exactly the deep and standard research models", async () => {
    const requests = fakeDecisionModel((_id, question) =>
      chooses(question, DEEP_RESEARCH_MODEL, 0.9)
    );

    await routeResearch("Research depth: deep\n\nHow does QUIC handle loss?");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.modelId).toBe(DECISION_MODEL);
    expect(requests[0]?.state).toContain("Research depth: deep");
    const [asked] = Object.values(requests[0]?.questions ?? {});
    expect(
      asked?.type === "choice" ? Object.keys(asked.criteria).sort() : []
    ).toEqual([DEEP_RESEARCH_MODEL, STANDARD_RESEARCH_MODEL].sort());
  });

  it.each([DEEP_RESEARCH_MODEL, STANDARD_RESEARCH_MODEL])(
    "runs the turn on %s when the decision model picks it",
    async (model) => {
      fakeDecisionModel((_id, question) => chooses(question, model, 0.9));

      await expect(
        routeResearch("What year was HTTP/3 standardized?")
      ).resolves.toBe(model);
    }
  );

  it("falls back to the standard research model when the decision fails", async () => {
    fakeDecisionModel(() => {
      throw new Error("decision model unavailable");
    });

    await expect(
      routeResearch("What year was HTTP/3 standardized?")
    ).resolves.toBe(STANDARD_RESEARCH_MODEL);
  });
});
