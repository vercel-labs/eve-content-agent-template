import { defineAgent } from "eve";

/**
 * Fresh-context web-research subagent.
 *
 * @remarks
 * A declared subagent — its `subagents/researcher/` location is what marks it as one — that the
 * root agent delegates to when a draft needs facts the Notion source material doesn't cover: a
 * statistic, a competitor detail, a primary-source link, or a claim to verify. It runs in its own
 * child session with no shared history and, like every declared subagent, inherits none of the
 * root's skills, connections, or tools. It does, however, get the framework default harness —
 * which includes `web_search` (provider-managed; Exa by default for AI Gateway models, or add
 * `tools/web_search.ts` exporting `webSearch({ provider: "native" })` for the model vendor's own
 * search) and `web_fetch` — so a web
 * researcher needs no tool wiring. It judges and gathers only from what the root packs into
 * `message` plus what it finds on the open web.
 *
 * That isolation is the point: a researcher that can't see the thread or invent from the draft's
 * momentum is forced to ground every claim in a real, fetched source. It reinforces the root's
 * no-fabrication rule rather than weakening it — the root weaves in only `findings` that come
 * back with citations, and surfaces `gaps` to the writer instead of papering over them.
 *
 * `tool: false` hides the default model-facing subagent tool: the root reaches this agent through
 * the `research` workflow tool (`agent/tools/research.ts`), which opens it with `ctx.agent()` and
 * requests the structured, cited result as the turn's `outputSchema` (eve no longer accepts
 * `outputSchema` on `defineAgent`). `description` is still required for a subagent.
 *
 * @see The research methodology and output contract in this folder's `instructions.md`.
 */
export default defineAgent({
  description:
    "Research a topic on the open web for facts, statistics, primary sources, and links the " +
    "writer needs but Notion doesn't cover. Runs refined searches against reliable sources and " +
    "returns cited findings with confidence levels, plus the gaps it couldn't verify.",
  model: "anthropic/claude-opus-4.8",
  tool: false,
});
