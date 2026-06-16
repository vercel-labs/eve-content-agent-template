# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project overview

A Slack-based content assistant built on the [Eve](https://beta.eve.dev) agent framework.
Writers @mention it in Slack; it loads a per-surface style **skill**, pulls source material
from **Notion** (user-scoped OAuth via Vercel Connect), drafts in the house voice, and
publishes approved pieces back to Notion. Files and assets are stored in **Vercel Blob**.

The whole agent is defined under `agent/`. Eve discovers capabilities from the filesystem.
See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the component map, data flow, and boundaries.

## Setup & commands

```bash
pnpm install        # install dependencies (Node >= 24)
pnpm dev            # eve dev — local TUI; run /model once to link a model provider
pnpm typecheck      # tsgo (TypeScript, no emit)
pnpm check          # ultracite (Biome) lint + format check
pnpm fix            # ultracite (Biome) auto-fix
pnpm build          # eve build
eve deploy          # deploy to Vercel production (use this, not raw `vercel deploy`)
npx eve info        # print the discovered surface + discovery diagnostics
```

There is no unit-test suite. **Verify changes with `pnpm typecheck` and `npx eve info`
(both must report 0 errors / 0 warnings), then exercise the agent in the `pnpm dev` TUI.**

## Eve conventions

- **Read the relevant guide in `node_modules/eve/docs/` before writing code.** Don't invent
  framework APIs; confirm them against the docs.
- **Identity comes from the filesystem, never a `name` field.** A tool at
  `agent/tools/upload_asset.ts` is the tool `upload_asset`; a connection at
  `agent/connections/notion.ts` registers as `notion`.
- Authored slots: `agent/agent.ts` (model), `agent/instructions.md` (system prompt),
  `agent/tools/*.ts` (`defineTool`), `agent/connections/*.ts`, `agent/channels/*.ts`,
  `agent/skills/<name>/SKILL.md`, `agent/sandbox.ts`.
- **Tools** run in the app runtime (full `process.env`), one default export per file. Gate
  destructive tools with `needsApproval` from `eve/tools/approval`.
- **Skills** are load-on-demand. A packaged skill (`<name>/SKILL.md`) requires `description`
  frontmatter; that description is the routing hint.
- After editing, **check LSP diagnostics / `pnpm typecheck`** and fix type errors before
  moving on.

## Code style

- Linting and formatting are handled by **Ultracite** (a Biome preset). Run `pnpm check`
  before finishing and `pnpm fix` to auto-fix. Config is in `biome.jsonc`; the kebab-case
  filename rule is disabled there because Eve tools use snake_case names.
- TypeScript strict; ESM with `NodeNext` resolution (relative imports need a `.js`
  extension). Prefer `const`, arrow functions, optional chaining / nullish coalescing.
- Validate tool input/output with `zod` schemas.
- Document exported config with **TSDoc** (`@remarks`, `@param`, `@returns`, `@defaultValue`,
  `@see`). Avoid inline `//` comments — put rationale in the TSDoc block instead.

## Security

- **Never ask the user for API keys, client secrets, or any other credentials.**
- **Never commit secrets.** `.env*` is gitignored. Connector UIDs are read from env
  (`SLACK_CONNECTOR`, `NOTION_CONNECTOR`); Notion auth is per-user via Vercel Connect and
  Blob auth is via the project's OIDC token — there are no API keys in code.
- When building a `RegExp` from data, escape it (literal match) to avoid ReDoS; bound
  untrusted input length.
- Gate irreversible actions (e.g. `delete_asset`) behind `needsApproval`.

## Before committing

- `pnpm typecheck` passes.
- `pnpm check` (Ultracite) passes.
- `npx eve info` reports 0 errors / 0 warnings.
- No secrets, `node_modules`, or build output (`.eve`, `.vercel`, `.output`) staged.
