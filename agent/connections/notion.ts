import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

/**
 * Vercel Connect connector UID for the Notion MCP server.
 *
 * @defaultValue `"mcp.notion.com/notion"` — the UID `vercel connect create mcp.notion.com
 * --name notion` produces (UIDs are `<type>/<name>`)
 * Override with the `NOTION_CONNECTOR` environment variable when your connector uses a different
 * name.
 */
const notionConnector = process.env.NOTION_CONNECTOR ?? "mcp.notion.com/notion";

/**
 * Notion workspace connection (MCP) exposing search, read, and edit tools to the model.
 *
 * @remarks
 * Authorization is user-scoped via Vercel Connect: each writer signs in through their own
 * browser consent flow, the per-user token is resolved before every tool call, and it is
 * never exposed to the model. All Notion tools are exposed, so the model creates draft pages
 * directly through the connection.
 *
 * @see {@link https://vercel.com/docs/connect | Vercel Connect}
 */
export default defineMcpClientConnection({
  url: "https://mcp.notion.com/mcp",
  description: "Notion workspace: search, read, and edit pages and databases.",
  auth: connect(notionConnector),
});
