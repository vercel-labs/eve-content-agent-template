import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";

/**
 * One real, fetched source backing a finding.
 */
const SOURCE_SCHEMA = z.object({
  title: z.string().describe("The source's title or publication name."),
  url: z.string().describe("The source URL, as visited."),
});

/**
 * Structured result the `researcher` subagent must return: cited findings plus the gaps it
 * couldn't verify.
 *
 * @remarks
 * Passed to the subagent turn as its `outputSchema`, so eve makes the child deliver exactly this
 * shape, and declared as this tool's `outputSchema`, so the root receives it typed and validated.
 * The contract mirrors the researcher's `instructions.md`.
 */
const RESEARCH_SCHEMA = z.object({
  findings: z
    .array(
      z.object({
        claim: z
          .string()
          .describe("A single, specific factual claim the draft can rely on."),
        confidence: z
          .enum(["high", "medium", "low"])
          .describe(
            "'high' = multiple strong independent sources; 'low' = single or weaker source."
          ),
        notes: z
          .string()
          .describe(
            "Caveats: date-sensitivity, scope limits, or where sources disagree."
          ),
        sources: z
          .array(SOURCE_SCHEMA)
          .min(1)
          .describe(
            "The real, fetched sources backing the claim; never empty, never invented."
          ),
      })
    )
    .describe(
      "One entry per verified factual claim; every entry carries at least one real source."
    ),
  gaps: z
    .array(z.string())
    .describe(
      "What could not be found or verified; surfaced to the writer rather than guessed at."
    ),
  summary: z
    .string()
    .describe(
      "A 1-3 sentence synthesis of what the research establishes, for the root to scan first."
    ),
});

/**
 * Model-facing wrapper around the `researcher` subagent that returns structured, cited findings.
 *
 * @remarks
 * eve no longer accepts `outputSchema` on `defineAgent`; structured output is requested per turn
 * through `ctx.agent(name).send(message, { outputSchema })` from a workflow tool. The subagent
 * sets `tool: false`, so this tool is the model's only way to reach it; the root passes the same
 * `message` it used to send the subagent directly. The tool can't share the subagent's name —
 * eve's compiler rejects a tool and a subagent with the same public name — hence `research`.
 *
 * Each call opens a fresh child session that ends when the call finishes, so the researcher
 * never sees the thread or earlier research — the isolation that forces it to ground every
 * claim in a fetched source. The call blocks the root's turn until the findings arrive. A failed
 * child turn fails the call with the child's error.
 *
 * @see The researcher's methodology and output contract in
 * `agent/subagents/researcher/instructions.md`.
 */
export default defineWorkflowTool({
  description:
    "Research a topic on the open web for facts, statistics, primary sources, and links the " +
    "writer needs but Notion doesn't cover. Runs refined searches against reliable sources and " +
    "returns cited findings with confidence levels, plus the gaps it couldn't verify. The " +
    "researcher does not see this conversation, so put the question and every piece of known " +
    "context and constraints (recency, region, source type) in `message`.",
  /**
   * Run one research turn in a fresh `researcher` session and return its structured result.
   *
   * @param input - Validated tool input.
   * @param input.message - Everything the researcher needs: the question, context, constraints.
   * @param ctx - Workflow tool context; supplies `agent()` and the call's `abortSignal`.
   * @returns The researcher's `summary`, cited `findings`, and `gaps`.
   * @throws When the researcher's turn fails or is cancelled before it delivers a result.
   */
  async execute({ message }, ctx) {
    "use workflow";
    const response = await ctx.agent("researcher").send(message, {
      outputSchema: RESEARCH_SCHEMA,
      signal: ctx.abortSignal,
    });
    const result = await response.result();
    if (result.status === "failed") {
      throw new Error(
        `The researcher failed: ${result.error?.message ?? "unknown error"}`
      );
    }
    if (result.data === undefined) {
      throw new Error("The researcher stopped before returning findings.");
    }
    return result.data;
  },
  inputSchema: z.object({
    message: z
      .string()
      .min(1)
      .describe(
        "The research question plus all relevant context and constraints. The researcher sees nothing else."
      ),
  }),
  outputSchema: RESEARCH_SCHEMA,
});
