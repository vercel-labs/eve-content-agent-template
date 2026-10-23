import { defineAgent } from "eve";

/**
 * Fresh-context reviewer subagent.
 *
 * @remarks
 * A declared subagent — its `subagents/reviewer/` location is what marks it as one — that the
 * root agent delegates to for a final, unbiased pass over a finished draft. It runs in its own
 * child session with no shared history and, like every declared subagent, inherits none of the
 * root's skills, connections, or tools. The root packs only the surface and the draft into
 * `message`; the reviewer loads the matching style rubric itself through its own
 * `get_surface_rubric` tool — a build-time bundle (`lib/rubric.generated.ts`, written by
 * `scripts/sync-shared.mjs`) of the house lists and each surface's best-practices and specs, so
 * no skills or sandbox are needed. That isolation is the point — a reviewer that never saw the
 * source or the drafting reasoning catches the voice drift, AI-tells, and spec misses that
 * self-review rationalizes away. It complements `lint_against_style` (a deterministic
 * banned-words floor) by judging the qualitative rubric a regex cannot.
 *
 * `tool: false` hides the default model-facing subagent tool: the root reaches this agent through
 * the `review` workflow tool (`agent/tools/review.ts`), which opens it with `ctx.agent()` and
 * requests the structured verdict as the turn's `outputSchema` (eve no longer accepts
 * `outputSchema` on `defineAgent`). `description` is still required for a subagent.
 *
 * @see The review rubric and verdict contract in this folder's `instructions.md`.
 */
export default defineAgent({
  description:
    "Review a finished draft with fresh context against the active surface's style rubric " +
    "(voice, AI-tells, plain English, structure, specs) and return a verdict. The caller " +
    "passes the surface and the draft; the reviewer loads the matching rubric itself.",
  model: "anthropic/claude-opus-4.8",
  tool: false,
});
