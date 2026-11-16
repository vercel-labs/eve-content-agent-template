# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

A Slack-based content assistant built on the [eve](https://eve.dev) agent framework.
Writers @mention it in Slack; it loads a per-surface style **skill**, pulls source material
from **Notion** (user-scoped OAuth via Vercel Connect), drafts in the house voice, and
publishes approved pieces back to Notion. Files and assets are stored in **Vercel Blob**.

The whole agent is defined under `agent/`. eve discovers capabilities from the filesystem.
See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the component map, data flow, and boundaries.

## Setup & commands

```bash
pnpm install        # install dependencies (Node >= 24)
pnpm dev            # eve dev — local TUI; run /login once to connect a model provider
pnpm typecheck      # tsc (TypeScript, no emit); also enforces tests/types.test.ts
pnpm test           # vitest unit tests under tests/ — needs no server, model, or network
pnpm check          # ultracite (Biome) lint + format check
pnpm fix            # ultracite (Biome) auto-fix
pnpm build          # eve build
pnpm eval:offline   # evals/offline on mock models — no model calls, runs in seconds
pnpm eval           # evals/live on real models (needs Gateway credentials)
eve deploy          # deploy to Vercel production (use this, not raw `vercel deploy`)
npx eve info        # print the discovered surface + discovery diagnostics
```

**Verify changes with `pnpm typecheck`, `pnpm test`, and `npx eve info` (0 errors / 0
warnings), then run `pnpm eval:offline`, and `pnpm eval` when you have credentials, and exercise
the agent in the `pnpm dev` TUI.** The unit tests under `tests/` import the definitions under
`agent/` and call them directly, with no eve server; two of them also run a command on a
temporary copy of the project (`eve info` and `scripts/sync-shared.mjs`). The offline evals run
the agents on the mock models in `agent/lib/mock-model.ts` (`EVE_MOCK_MODEL=1`) through a local
eve server. Neither makes a model call. The live evals call real models, so they need the
project's AI Gateway credentials (`vercel env pull` or `/login` in the TUI).

## Testing

- **Keep tests in `tests/`, never under `agent/`**: eve turns the files it finds there into
  tools and other capabilities.
- **Call tools with `callTool` from `tests/helpers/tool.ts`.** It validates the input, runs
  `execute`, and validates the output against the tool's `outputSchema`, so every call also checks
  the declared contract. `acceptsInput` checks an input limit without running the tool.
- **Fake the edges, not the code under test.** `@vercel/blob` is mocked with `vi.mock`;
  subagents are faked with `fakeWorkflowContext` (`tests/helpers/workflow-context.ts`), which
  records what a workflow tool sent; `fakeDecisionModel` (`tests/helpers/decision-model.ts`)
  replaces only the decision model behind eve's real `decide()` and `auto()`. `tests/setup.ts`
  rejects any `fetch` and clears the environment variables the agent reads, so a test that
  reaches the network fails and the result doesn't depend on the shell.
- **Don't hard-code what a writer can customize.** The tests take surfaces, banned words, and
  model ids from the modules under `agent/lib/`, so editing a banned-words list, adding a style
  skill, or changing a model id needs no test change.
- **Adding or removing a tool or subagent changes `tests/discovery.test.ts`**, which pins the
  tools, subagents, and routes `eve info` reports. That is deliberate: it is also what catches
  an eve upgrade that adds a default tool.
- **Type contracts live in `tests/types.test.ts`** (`expectTypeOf`, `@ts-expect-error`) and are
  enforced by `pnpm typecheck`, not by `pnpm test`.

## eve conventions

- **Read the relevant guide in `node_modules/eve/docs/` before writing code.** Don't invent
  framework APIs; confirm them against the docs.
- **Identity comes from the filesystem, never a `name` field.** A tool at
  `agent/tools/upload_asset.ts` is the tool `upload_asset`; a connection at
  `agent/connections/notion.ts` registers as `notion`.
- Authored slots: `agent/agent.ts` (model), `agent/instructions.md` (system prompt),
  `agent/tools/*.ts` (`defineTool`, or `defineWorkflowTool` for durable tools such as `research`),
  `agent/connections/*.ts`, `agent/channels/*.ts`, `agent/skills/<name>/SKILL.md`,
  `agent/memory/<slot>.ts` (`defineMemory`), `agent/subagents/<id>/agent.ts` (`defineAgent`),
  `agent/sandbox.ts` (exports `environment` and a `defineSandbox()` default).
- **Tools** run in the app runtime (full `process.env`), one default export per file. Gate
  destructive tools with `approval` from `eve/tools/approval`. **Connections** accept the same
  `approval` field — pass a policy that inspects `toolName`/`toolInput` to gate specific tools
  (e.g. `notion` gates `notion-create-pages` via its `APPROVAL_REQUIRED_TOOLS` list).
- **Skills** are load-on-demand. A packaged skill (`<name>/SKILL.md`) requires `description`
  frontmatter; that description is the routing hint. Adding a new surface is just a new
  `<surface>-style` skill folder: the `SURFACES` enum that `check_style` and the reviewer's
  `get_surface_rubric` share is generated from those folders into `agent/lib/surfaces.generated.ts`
  by `pnpm sync:shared`, so there is no hand-edited enum to keep in step. Tool code can't read skill
  files at runtime, so each skill's `references/banned-words.json` is
  bundled into `agent/lib/banned-words.generated.ts` by the same script.
- **Shared references** live in `shared-references/` (the source of truth). `scripts/sync-shared.mjs`
  copies them into every skill's `references/` and regenerates the managed `## Shared references`
  section in each `SKILL.md` (the bullet text lives in that script's `SHARED_FILES`). Edit the
  source and run `pnpm sync:shared` (also run on `predev`/`prebuild`); never edit the synced copies
  or that section. A skill's own `## References` section is left untouched.
- **Subagents** are declared under `agent/subagents/<id>/agent.ts` (`defineAgent`, required
  `description` — the routing hint). The directory name is the identity and the lowered tool
  name (no namespace; it must not collide with a tool name). A declared subagent runs in a fresh
  child session and **inherits nothing** from the root (no skills, connections, tools, or
  sandbox), so the caller passes everything it needs in the `message`. Here: `researcher` and
  `reviewer` (the reviewer carries its own generated rubric module + `get_surface_rubric` tool
  rather than inheriting the root's skills). Structured output is requested per turn, not on
  `defineAgent`, so both set `tool: false` and the root reaches them through the `research` /
  `review` workflow tools, which call `askSubagent` (`agent/lib/subagent.ts`): one
  `ctx.agent("<id>").send(message, { outputSchema })`. A tool can't share a subagent's name (the
  compiler rejects it even with `tool: false`), hence the different names.
- **Models** are Gateway ids kept in `agent/lib/models.ts`. The researcher's model is routed per
  call with `auto()` from `eve/models` (a decision model picks from an allowlist using the research
  message; `fallback` covers decider failures only, including a message the decision provider
  rejects as too long. The router has no length limit of its own, so the `research` tool caps its
  message at 15,000 characters to bound routing cost). `check_style` asks the same decision
  model yes/no questions with `decide()` from `eve/ai`, inside a `"use step"` helper so replay
  reuses the answers. `decide` returns
  probabilities, not calibrated confidence: treat a mid-range value as "unsure" and fall back to a
  model that can reason (here, the `reviewer` subagent), and report why the fallback ran.
- After editing, **check LSP diagnostics / `pnpm typecheck`** and fix type errors before
  moving on.

## Code style

- Linting and formatting are handled by **Ultracite** (a Biome preset). Run `pnpm check`
  before finishing and `pnpm fix` to auto-fix. Config is in `biome.jsonc`; the kebab-case
  filename rule is disabled there because eve tools use snake_case names.
- TypeScript strict; ESM with `NodeNext` resolution (relative imports need a `.js`
  extension). Prefer `const`, arrow functions, optional chaining / nullish coalescing.
- Validate tool input/output with `zod` schemas.
- `@biomejs/biome` is pinned to 2.5.x: Ultracite 8.0.x's preset still configures a nursery rule
  that Biome 2.6 renamed, so Biome 2.6 refuses the config. Bump both together once Ultracite
  supports 2.6 (`pnpm exec ultracite doctor` checks the pairing).
- Document exported config with **TSDoc** (`@remarks`, `@param`, `@returns`, `@defaultValue`,
  `@see`). Avoid inline `//` comments — put rationale in the TSDoc block instead.

## Security

- **Never ask the user for API keys, client secrets, or any other credentials.**
- **Never commit secrets.** `.env*` is gitignored. Connector UIDs are read from env
  (`SLACK_CONNECTOR`, `NOTION_CONNECTOR`); Notion auth is per-user via Vercel Connect and
  Blob auth is via the project's OIDC token — there are no API keys in code.
- When building a `RegExp` from data, escape it (literal match) to avoid ReDoS; bound
  untrusted input length.
- Gate irreversible or high-impact actions behind `approval`: destructive tools
  (`delete_asset`) and connection writes (the `notion` connection gates `notion-create-pages`).
- For per-user storage, scope by the resolved principal (`ctx.session.auth.current`), never by
  model input — see `agent/memory/preferences.ts`, which gives only signed-in writers a memory
  document. The asset tools refuse the Blob prefixes listed in `agent/lib/reserved-paths.ts`, so
  they can't read or overwrite a writer's memory.
- Give each agent only the built-in tools it needs. The root has `bash`, `write_file`, and
  `edit_file` disabled. It keeps `read_file` (skills read their references with it) and eve's
  other defaults, `web_fetch`, `web_search`, and `agent`; `tests/discovery.test.ts` pins that
  list. The researcher and the reviewer set `defaultTools: false`, and the researcher adds back
  only `web_search` and `web_fetch`.

## Before committing

- `pnpm typecheck` passes.
- `pnpm test` passes.
- `pnpm check` (Ultracite) passes.
- `npx eve info` reports 0 errors / 0 warnings.
- No secrets, `node_modules`, or build output (`.eve`, `.vercel`, `.output`) staged.
