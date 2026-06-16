# Eve Content Agent Template

A Slack-based content assistant built on [Eve](https://beta.eve.dev). Writers @mention it in
Slack and it drafts blog posts, LinkedIn posts, release notes, and newsletters in your house
voice, pulling source material from Notion and publishing approved pieces back to Notion as
the signed-in writer.

- **Lives in Slack.** Answers @mentions and DMs, replies in threads, and renders approvals as
  buttons.
- **Writes in your voice.** One editable style skill per surface (blog, LinkedIn, release
  notes, newsletter), enforced by a deterministic style-lint tool.
- **Grounded in Notion.** Each writer signs in to their own Notion through Vercel Connect, so
  drafts are created as the real person with their own permissions, with no shared secret.
- **Stores files in Vercel Blob.** Export drafts, save images and attachments, and read them
  back, authenticated by the project's OIDC token.

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=eve-content-agent-template&repository-name=eve-content-agent-template&repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Feve-content-agent-template%2Ftree%2Fmain&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%2C%7B%22type%22%3A%22mcp.notion.com%22%2C%22env%22%3A%22NOTION_CONNECTOR%22%7D%5D&stores=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22public%22%7D%5D)

Deploying with the button provisions everything the agent needs and wires it up for you:

- a **Slack** connector (sets `SLACK_CONNECTOR`, with the event trigger pointed at
  `/eve/v1/slack`),
- a **Notion** connector (sets `NOTION_CONNECTOR`),
- a **Vercel Blob** store for the asset tools.

Once deployed, @mention the bot in your Slack workspace to start drafting.

## Tech stack

| Layer | Technology |
| --- | --- |
| Agent framework | [Eve](https://beta.eve.dev) |
| Language | TypeScript (strict, ESM) |
| Chat surface | Slack, via [Vercel Connect](https://vercel.com/docs/connect) |
| Source & publishing | Notion (MCP), user-scoped OAuth via Vercel Connect |
| File storage | [Vercel Blob](https://vercel.com/docs/vercel-blob), authenticated by OIDC |
| Model access | [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) (default: Claude Opus 4.8) |
| Sandbox | [Vercel Sandbox](https://vercel.com/docs/sandbox) |
| Lint & format | [Ultracite](https://www.ultracite.ai/) (Biome) |

**Zero static keys.** Authentication runs entirely on [Vercel Connect](https://vercel.com/docs/connect)
(Slack and Notion) and [Vercel OIDC](https://vercel.com/docs/oidc) (Vercel Blob and AI
Gateway). There are no API keys or client secrets to manage in code or `.env` files: Notion is
authorized per writer in the browser, and Blob and the model authenticate with the project's
OIDC token.

## What's inside

```text
agent/
  agent.ts                  # model configuration
  instructions.md           # the agent's behavior
  channels/slack.ts         # Slack surface (Vercel Connect credentials)
  connections/notion.ts     # Notion workspace, user-scoped OAuth via Vercel Connect
  sandbox.ts                # Vercel Sandbox backend
  tools/
    lint_against_style.ts   # deterministic banned-words check
    upload_asset.ts         # Vercel Blob: store text or binary content
    list_assets.ts          # Vercel Blob: browse stored assets
    get_asset_info.ts       # Vercel Blob: metadata without downloading
    download_asset.ts       # Vercel Blob: read a stored file back
    delete_asset.ts         # Vercel Blob: delete (requires approval)
  skills/
    blog-style/             # voice, structure, and a canonical example post
    linkedin-style/
    release-notes-style/
    newsletter-style/
```

## Local development

Link the project you deployed (or a fresh one) and pull its environment:

```bash
vercel link
vercel env pull
```

Then run the development server and link a model provider with `/model` in the TUI:

```bash
pnpm dev
```

You can chat with the agent directly in the dev TUI to test the drafting, style-lint, Notion,
and Blob flows. The Slack surface itself only runs against a deployment. Ship changes with:

```bash
eve deploy
```

### Linting and formatting

This project uses [Ultracite](https://www.ultracite.ai/) (a [Biome](https://biomejs.dev/)
preset) for linting and formatting:

```bash
pnpm check   # check formatting and lint rules
pnpm fix     # auto-fix what is fixable
```

### Setting up the connectors by hand

The Deploy button provisions these for you. To set them up manually (for a project you didn't
create with the button), use the [Vercel CLI](https://vercel.com/docs/cli):

```bash
# Notion connector (note the printed UID, e.g. mcp.notion.com/notion -> NOTION_CONNECTOR)
vercel connect create mcp.notion.com --name notion

# Slack connector (note the UID, e.g. slack/<name> -> SLACK_CONNECTOR), then point its
# event trigger at the route the agent serves
vercel connect create slack --name <name> --triggers
vercel connect attach slack/<name> --triggers --trigger-path /eve/v1/slack

# Blob store, connected to the project for all environments
vercel blob create-store <name> --access public --yes
```

## Customizing

- **Voice:** edit the per-surface skills in `agent/skills/*/SKILL.md`, and the
  `references/banned-words.json` each one lints against. Add a new surface by adding a new
  skill folder.
- **Behavior:** edit `agent/instructions.md`.
- **Model:** edit `agent/agent.ts` (or run `/model` in the dev TUI).
- **Tools:** add or change tools in `agent/tools/`. The filename is the tool name.

The agent auto-updates as you edit these files.

## Learn more

- [Eve documentation](https://beta.eve.dev/docs/introduction): the framework powering this agent.
- [Vercel Connect](https://vercel.com/docs/connect): manages the Slack and Notion credentials.
- [Vercel Blob](https://vercel.com/docs/vercel-blob): object storage for the asset tools.
