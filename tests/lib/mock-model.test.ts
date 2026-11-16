import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { SCRIPTED_MODEL, structuredReplyModel } from "#lib/mock-model.js";

type Prompt = Parameters<MockLanguageModelV4["doGenerate"]>[0]["prompt"];
type PromptMessage = Prompt[number];

/**
 * Narrow one of the project's mock models to the AI SDK mock it is at runtime.
 *
 * @param model - A model built by `mockModel` from `eve/evals`.
 * @returns The same model, typed so a test can call `doGenerate` on it.
 */
const asMock = (model: unknown): MockLanguageModelV4 => {
  if (!(model instanceof MockLanguageModelV4)) {
    throw new Error("Expected an AI SDK v4 mock language model.");
  }
  return model;
};

/**
 * Build a user message.
 *
 * @param text - The message text.
 * @returns A prompt message with one text part.
 */
const user = (text: string): PromptMessage => ({
  content: [{ text, type: "text" }],
  role: "user",
});

/**
 * Build the assistant tool call and tool result that follow a scripted tool call.
 *
 * @param toolName - The tool that was called.
 * @param value - The JSON the tool returned.
 * @returns The two prompt messages eve appends after the tool settles.
 */
const toolRound = (toolName: string, value: unknown): PromptMessage[] => [
  {
    content: [{ input: {}, toolCallId: "call_1", toolName, type: "tool-call" }],
    role: "assistant",
  },
  {
    content: [
      {
        output: { type: "json", value: value as never },
        toolCallId: "call_1",
        toolName,
        type: "tool-result",
      },
    ],
    role: "tool",
  },
];

/**
 * Run one model call and return what the model produced.
 *
 * @param model - The mock model to call.
 * @param prompt - The conversation so far.
 * @returns The generated content parts and the unified finish reason.
 */
const generate = async (model: unknown, prompt: Prompt) => {
  const { content, finishReason } = await asMock(model).doGenerate({ prompt });
  return { content, finish: finishReason.unified };
};

describe("SCRIPTED_MODEL", () => {
  it("calls the scripted tool once with the scripted input", async () => {
    const script = { input: { prefix: "drafts/" }, tool: "list_assets" };

    const { content, finish } = await generate(SCRIPTED_MODEL, [
      user(JSON.stringify(script)),
    ]);

    expect(finish).toBe("tool-calls");
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      input: JSON.stringify(script.input),
      toolName: "list_assets",
      type: "tool-call",
    });
  });

  it("defaults the tool input to an empty object", async () => {
    const { content } = await generate(SCRIPTED_MODEL, [
      user(JSON.stringify({ tool: "list_assets" })),
    ]);

    expect(content[0]).toMatchObject({ input: "{}", toolName: "list_assets" });
  });

  it("replies with the tool results as JSON once the tool settles", async () => {
    const { content, finish } = await generate(SCRIPTED_MODEL, [
      user(JSON.stringify({ tool: "list_assets" })),
      ...toolRound("list_assets", { count: 0 }),
    ]);

    expect(finish).toBe("stop");
    expect(content[0]?.type).toBe("text");
    const text = content[0]?.type === "text" ? content[0].text : "";
    expect(JSON.parse(text)).toEqual([
      {
        id: "call_1",
        isError: false,
        name: "list_assets",
        output: { count: 0 },
      },
    ]);
  });

  it.each([
    "What do you remember about me?",
    "{ not json",
    JSON.stringify({ input: {} }),
    JSON.stringify({ tool: 42 }),
    JSON.stringify(["tool", "list_assets"]),
    "null",
  ])(
    "echoes every user message when the latest isn't a tool script: %s",
    async (latest) => {
      const { content, finish } = await generate(SCRIPTED_MODEL, [
        user("Prefers British spelling."),
        user(latest),
      ]);

      expect(finish).toBe("stop");
      expect(content).toEqual([
        { text: `Prefers British spelling.\n${latest}`, type: "text" },
      ]);
    }
  );
});

describe("structuredReplyModel", () => {
  it("delivers the built result through eve's structured-reply tool", async () => {
    const model = structuredReplyModel((message) => ({ summary: message }));

    const { content, finish } = await generate(model, [user("Research this.")]);

    expect(finish).toBe("tool-calls");
    expect(content[0]).toMatchObject({
      input: JSON.stringify({ summary: "Research this." }),
      toolName: "eve__reply",
      type: "tool-call",
    });
  });

  it("ends the turn with plain text after the reply tool settles", async () => {
    const model = structuredReplyModel(() => ({ verdict: "ready" }));

    const { content, finish } = await generate(model, [
      user("Review this."),
      ...toolRound("eve__reply", { ok: true }),
    ]);

    expect(finish).toBe("stop");
    expect(content).toEqual([{ text: "Done.", type: "text" }]);
  });
});
