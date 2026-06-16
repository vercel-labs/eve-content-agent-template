# ARCHITECTURE.md

A map of how this agent is put together, for humans and AI agents working in the repo. Keep
it current as the codebase evolves.

## Project identification

- **Name:** Content Agent (Eve content assistant template)
- **Maintainer:** Vercel Labs
- **License:** Apache-2.0
- **Last updated:** 2026-06-16

## Overview

A Slack-based content assistant built on the [Eve](https://beta.eve.dev) agent framework.
Writers talk to it in Slack; it loads a per-surface style skill, reads source material from
Notion, drafts in the house voice, and writes approved pieces back to Notion as the
signed-in writer. Generated files and assets live in Vercel Blob. The agent runs on Vercel,
the same way locally (`eve dev`) and in production (`eve deploy`).

Eve discovers every capability from the filesystem under `agent/`. There is no central
registry or wiring file: a tool's name is its filename, a connection's name is its filename,
and so on.

## Project structure

```text
agent/
  agent.ts                  # model configuration (defineAgent)
  instructions.md           # base system prompt / behavior
  channels/
    slack.ts                # Slack surface; credentials via Vercel Connect
  connections/
    notion.ts               # Notion MCP server, user-scoped OAuth via Vercel Connect
  sandbox.ts                # sandbox backend (Vercel Sandbox)
  tools/
    lint_against_style.ts   # banned-words check against the active surface's skill
    upload_asset.ts         # Vercel Blob: store text/binary
    list_assets.ts          # Vercel Blob: browse
    get_asset_info.ts       # Vercel Blob: metadata
    download_asset.ts       # Vercel Blob: read back (Blob URLs only)
    delete_asset.ts         # Vercel Blob: delete (needsApproval)
  skills/
    blog-style/             # SKILL.md + references/{good-post.md,banned-words.json}
    linkedin-style/         # SKILL.md + references/banned-words.json
    release-notes-style/    # "
    newsletter-style/       # "
```

## Core components

| Component | Lives in | Eve primitive | Responsibility |
| --- | --- | --- | --- |
| Slack surface | `agent/channels/slack.ts` | Channel | Receives @mentions/DMs, threads replies, renders approvals as buttons |
| Agent runtime | `agent/agent.ts` + `instructions.md` | Agent | The model loop and behavior; orchestrates skills, tools, and the connection |
| Style skills | `agent/skills/<surface>-style/` | Skill | Voice/structure rules per surface, loaded on demand |
| Style lint | `agent/tools/lint_against_style.ts` | Tool | Deterministic banned-words check, reads the skill's `banned-words.json` |
| Notion access | `agent/connections/notion.ts` | Connection (MCP) | Search/read/write Notion as the signed-in writer |
| Asset tools | `agent/tools/{upload,list,get_asset_info,download,delete}_asset.ts` | Tools | Store and manage files in Vercel Blob |

Channels and the connection are I/O boundaries. Tools run in the app runtime (full
`process.env`). Skills only add instructions to context; they are not an execution surface.

## Data stores

- **Notion** (external, user-owned): the source material and the destination **Drafts**
  database. The agent never holds a shared Notion credential; it acts as each writer via
  their own OAuth token.
- **Vercel Blob**: object storage for exported drafts, images, and attachments. Authenticated
  by the project's OIDC token (no `BLOB_READ_WRITE_TOKEN`).
- **Vercel Sandbox** (`/workspace/skills/...`): holds the seeded skill files the lint tool and
  model read. Not a durable application data store.

There is no application database.

## External integrations

| Integration | Purpose | Method |
| --- | --- | --- |
| Slack | Chat surface (inbound events + outbound messages) | Vercel Connect connector (`SLACK_CONNECTOR`), webhook trigger at `/eve/v1/slack` |
| Notion (MCP) | Read source material, write drafts | MCP connection with user-scoped OAuth via Vercel Connect (`NOTION_CONNECTOR`) |
| Vercel Blob | File/asset storage | `@vercel/blob`, OIDC-authenticated |
| Vercel AI Gateway | Model access | Gateway model id (`anthropic/claude-opus-4.8`) resolved through the linked project |
| Vercel Sandbox | Isolated runtime that holds seeded skill files | `agent/sandbox.ts` (`vercelSandboxBackend`) |

## Deployment & infrastructure

- **Platform:** Vercel. Deploy with `eve deploy` (wraps `vercel deploy --prod`); the raw
  `vercel deploy` cannot auto-detect the Eve framework.
- **Connectors:** provisioned via the Deploy button or `vercel connect create` + `attach`;
  the Slack trigger must point at `/eve/v1/slack`.
- **Environment:** `SLACK_CONNECTOR` and `NOTION_CONNECTOR` (connector UIDs) in the Vercel
  project; the model and Blob authenticate via the project's OIDC token.
- **Local development:** `pnpm dev` runs the same runtime in a TUI; `vercel env pull`
  supplies a short-lived OIDC token. The Slack surface only runs against a deployment.

## Security considerations

- **Inbound route auth** (`agent/channels/`): the framework default `[localDev(),
  vercelOidc()]` rejects public browser traffic; Slack traffic is authenticated by its
  connector. Slack's `defaultSlackAuth` issues a per-user (`principalType: "user"`)
  principal.
- **Outbound auth:** Notion is per-writer OAuth via Vercel Connect (token resolved per call,
  never exposed to the model); Blob uses the project OIDC token. No API keys live in code,
  and `.env*` is gitignored.
- **Human-in-the-loop:** irreversible actions (`delete_asset`) are gated with `needsApproval`
  from `eve/tools/approval`, rendered as a Slack approve/deny button.
- **Input hardening:** `lint_against_style` escapes banned words before building a `RegExp`
  (prevents ReDoS) and bounds input length; `download_asset` only fetches
  `*.blob.vercel-storage.com` URLs (prevents SSRF).

## Development & testing

- **Runtime/TUI:** `pnpm dev` (Eve dev TUI; `/model` links a provider).
- **Type checking:** `pnpm typecheck` (tsgo).
- **Lint/format:** `pnpm check` / `pnpm fix` (Ultracite, a Biome preset; config in
  `biome.jsonc`).
- **Discovery diagnostics:** `npx eve info` (must report 0 errors / 0 warnings).
- There is no unit-test suite; verify behavior in the dev TUI.

## Future considerations

- Richer Markdown to Notion block conversion (headings, lists, code) beyond paragraph splits.
- Optional asset tools not yet included: `copy_asset` and bulk `delete_assets`.
- An optional hard write gate: an authored `publish_to_notion` tool with `needsApproval`
  (instead of relying on the in-thread approval convention), if a button-based publish
  confirmation is wanted.

## Glossary

- **Eve:** the agent framework powering this app; discovers capabilities from `agent/`.
- **Channel:** an inbound/outbound surface (here, Slack).
- **Connection:** an external server (MCP/OpenAPI) exposed to the model; tools are called as
  `connection__<name>__<tool>`.
- **Tool:** a typed action authored with `defineTool`, run in the app runtime.
- **Skill:** a load-on-demand Markdown procedure; the packaged form requires `description`
  frontmatter used for routing.
- **Surface:** a content type with its own style skill (blog, LinkedIn, release-notes,
  newsletter).
- **Vercel Connect:** brokers OAuth/credentials for Slack and Notion; connectors are
  identified by a UID.
- **OIDC:** the project's Vercel identity token, used to authenticate Blob (and AI Gateway)
  without static keys.
