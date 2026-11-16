import { describe, expect, it } from "vitest";
import { z } from "zod";
import { askSubagent } from "#lib/subagent.js";
import {
  cancelled,
  completed,
  failed,
  fakeWorkflowContext,
} from "../helpers/workflow-context.js";

const SCHEMA = z.object({ answer: z.string() });

describe("askSubagent", () => {
  it("returns the subagent's structured data", async () => {
    const { ctx } = fakeWorkflowContext(() => completed({ answer: "42" }));
    await expect(
      askSubagent(ctx, "researcher", "What is it?", SCHEMA)
    ).resolves.toEqual({ answer: "42" });
  });

  it("sends one message to the named subagent with the schema and abort signal", async () => {
    const { calls, controller, ctx } = fakeWorkflowContext(() =>
      completed({ answer: "ok" })
    );
    await askSubagent(ctx, "reviewer", "Surface: blog", SCHEMA);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("reviewer");
    expect(calls[0]?.message).toBe("Surface: blog");
    expect(calls[0]?.options?.outputSchema).toBe(SCHEMA);
    expect(calls[0]?.options?.signal).toBe(controller.signal);
  });

  it("throws the subagent's error when its turn fails", async () => {
    const { ctx } = fakeWorkflowContext(() => failed("model overloaded"));
    await expect(askSubagent(ctx, "researcher", "Q", SCHEMA)).rejects.toThrow(
      "The researcher failed: model overloaded"
    );
  });

  it("throws when the turn ends without a result", async () => {
    const { ctx } = fakeWorkflowContext(() => cancelled());
    await expect(askSubagent(ctx, "reviewer", "Q", SCHEMA)).rejects.toThrow(
      "The reviewer stopped before returning a result."
    );
  });

  it("propagates a rejected send", async () => {
    const { ctx } = fakeWorkflowContext(() => {
      throw new Error("session could not open");
    });
    await expect(askSubagent(ctx, "reviewer", "Q", SCHEMA)).rejects.toThrow(
      "session could not open"
    );
  });
});
