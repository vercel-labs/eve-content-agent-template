import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";

/**
 * Structured verdict the `reviewer` subagent must return.
 *
 * @remarks
 * Passed to the subagent turn as its `outputSchema`, so eve makes the child deliver exactly this
 * shape, and declared as this tool's `outputSchema`, so the root receives it typed and validated.
 * The contract mirrors the reviewer's `instructions.md`.
 */
const REVIEW_SCHEMA = z.object({
  issues: z
    .array(
      z.object({
        fix: z.string().describe("A concrete suggested change."),
        quote: z
          .string()
          .describe("The offending excerpt, quoted from the draft."),
        rule: z
          .string()
          .describe("The rubric rule or reference the excerpt breaks."),
        severity: z.enum(["high", "medium", "low"]),
      })
    )
    .describe(
      "One entry per concrete problem; empty when the verdict is 'ready'."
    ),
  verdict: z
    .enum(["ready", "revise"])
    .describe(
      "'ready' = clean enough to send as-is; 'revise' = fix the issues first."
    ),
});

/**
 * Model-facing wrapper around the `reviewer` subagent that returns a structured verdict.
 *
 * @remarks
 * eve no longer accepts `outputSchema` on `defineAgent`; structured output is requested per turn
 * through `ctx.agent(name).send(message, { outputSchema })` from a workflow tool. The subagent
 * sets `tool: false`, so this tool is the model's only way to reach it; the root passes the same
 * `message` it used to send the subagent directly. The tool can't share the subagent's name —
 * eve's compiler rejects a tool and a subagent with the same public name — hence `review`.
 *
 * Each call opens a fresh child session that ends when the call finishes, so every review is a
 * genuinely fresh-eyes pass that never saw the source material, the drafting reasoning, or an
 * earlier review. The call blocks the root's turn until the verdict arrives, so the root can act
 * on it before proposing the draft. A failed child turn fails the call with the child's error.
 *
 * @see The reviewer's rubric and verdict contract in `agent/subagents/reviewer/instructions.md`.
 */
export default defineWorkflowTool({
  description:
    "Review a finished draft with fresh context against the active surface's style rubric " +
    "(voice, AI-tells, plain English, structure, specs) before it goes to the writer. The " +
    "reviewer does not see this conversation, so put the surface and the full draft in " +
    "`message`; it loads the matching rubric itself and returns a verdict.",
  /**
   * Run one review turn in a fresh `reviewer` session and return its structured verdict.
   *
   * @param input - Validated tool input.
   * @param input.message - The surface and the full draft to review.
   * @param ctx - Workflow tool context; supplies `agent()` and the call's `abortSignal`.
   * @returns The reviewer's `verdict` and `issues`.
   * @throws When the reviewer's turn fails or is cancelled before it delivers a verdict.
   */
  async execute({ message }, ctx) {
    "use workflow";
    const response = await ctx.agent("reviewer").send(message, {
      outputSchema: REVIEW_SCHEMA,
      signal: ctx.abortSignal,
    });
    const result = await response.result();
    if (result.status === "failed") {
      throw new Error(
        `The reviewer failed: ${result.error?.message ?? "unknown error"}`
      );
    }
    if (result.data === undefined) {
      throw new Error("The reviewer stopped before returning a verdict.");
    }
    return result.data;
  },
  inputSchema: z.object({
    message: z
      .string()
      .min(1)
      .describe(
        "The surface (e.g. 'blog') and the full draft. The reviewer sees nothing else."
      ),
  }),
  outputSchema: REVIEW_SCHEMA,
});
