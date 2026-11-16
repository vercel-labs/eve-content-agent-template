import { decide } from "eve/ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DECISION_MODEL } from "#lib/models.js";
import { SURFACE_DESCRIPTIONS, SURFACES } from "#lib/surfaces.generated.js";
import detectSurface from "#tools/detect_surface.js";
import { acceptsInput, callTool } from "../helpers/tool.js";
import { toolContext } from "../helpers/tool-context.js";

vi.mock("eve/ai", () => ({ decide: vi.fn() }));

const REQUEST = "Write up the launch for our changelog.";

/**
 * Make the mocked decision model pick a choice.
 *
 * @param choice - The option the model chose.
 * @param probabilities - Per-option probabilities, or `undefined` when the model gave none.
 */
const decideChoice = (
  choice: string,
  probabilities?: Record<string, number>
): void => {
  vi.mocked(decide).mockResolvedValue({
    answers: { surface: { choice, probabilities, type: "choice" } },
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

describe("detect_surface", () => {
  it("returns the surface when the model is confident", async () => {
    decideChoice("release-notes", { "release-notes": 0.93 });

    await expect(
      callTool(detectSurface, { request: REQUEST }, toolContext())
    ).resolves.toEqual({
      outcome: "confident",
      probability: 0.93,
      surface: "release-notes",
    });
  });

  it("offers every surface, by its skill description, plus a not-stated option", async () => {
    decideChoice("blog", { blog: 0.9 });
    const abort = new AbortController();

    await callTool(
      detectSurface,
      { request: REQUEST },
      toolContext(abort.signal)
    );

    expect(decide).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(decide).mock.calls[0] ?? [];
    expect(options?.model).toBe(DECISION_MODEL);
    expect(options?.signal).toBe(abort.signal);
    expect(options?.state).toEqual({ request: REQUEST });
    const question = options?.questions.surface;
    expect(question?.type).toBe("choice");
    expect(Object.keys(question?.criteria ?? {}).sort()).toEqual(
      [...SURFACES, "not-stated"].sort()
    );
    expect(question?.criteria).toMatchObject(SURFACE_DESCRIPTIONS);
  });

  it.each([
    { outcome: "confident", probability: 1 },
    { outcome: "confident", probability: 0.75 },
    { outcome: "unsure", probability: 0.749_999 },
    { outcome: "unsure", probability: 0.4 },
    { outcome: "unsure", probability: 0 },
  ] as const)(
    "probability $probability is $outcome",
    async ({ outcome, probability }) => {
      decideChoice("x", { x: probability });

      await expect(
        callTool(detectSurface, { request: REQUEST }, toolContext())
      ).resolves.toEqual({
        outcome,
        probability,
        surface: outcome === "confident" ? "x" : null,
      });
    }
  );

  it("asks the writer when the model says the surface isn't stated, however sure it is", async () => {
    decideChoice("not-stated", { "not-stated": 0.99 });

    await expect(
      callTool(detectSurface, { request: "Write something." }, toolContext())
    ).resolves.toEqual({ outcome: "unsure", probability: 0.99, surface: null });
  });

  it("asks the writer when the model gives no probability", async () => {
    decideChoice("blog");

    await expect(
      callTool(detectSurface, { request: REQUEST }, toolContext())
    ).resolves.toEqual({ outcome: "unsure", probability: null, surface: null });
  });

  it("reports a decision-model failure instead of throwing", async () => {
    vi.mocked(decide).mockRejectedValue(new Error("gateway unavailable"));

    await expect(
      callTool(detectSurface, { request: REQUEST }, toolContext())
    ).resolves.toEqual({
      outcome: "decide_error",
      probability: null,
      surface: null,
    });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("bounds the request to 1-8,000 characters", async () => {
    const accepts = (request: string) =>
      acceptsInput(detectSurface, { request });
    expect(await accepts("")).toBe(false);
    expect(await accepts("a".repeat(8000))).toBe(true);
    expect(await accepts("a".repeat(8001))).toBe(false);
    expect(await acceptsInput(detectSurface, {})).toBe(false);
  });
});
