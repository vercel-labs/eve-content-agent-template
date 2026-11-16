import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalFor } from "./helpers/tool.js";

/**
 * The fields of the Notion connection these tests read.
 */
interface NotionConnection {
  readonly approval: unknown;
  readonly auth: {
    readonly principalType: string;
    readonly vercelConnect: { readonly connector: string };
  };
  readonly description: string;
  readonly url: string;
}

/**
 * Import the Notion connection fresh, under a chosen `NOTION_CONNECTOR` setting.
 *
 * @param connector - The value for `NOTION_CONNECTOR`, or `undefined` to leave it unset.
 * @returns The connection definition.
 */
const loadNotion = async (connector?: string): Promise<NotionConnection> => {
  vi.resetModules();
  vi.stubEnv("NOTION_CONNECTOR", connector);
  const module: { default: unknown } = await import(
    "../agent/connections/notion.js"
  );
  return module.default as NotionConnection;
};

afterEach(() => {
  vi.resetModules();
});

describe("notion connection", () => {
  it("points at Notion's MCP server with a description for the model", async () => {
    const notion = await loadNotion();
    expect(notion.url).toBe("https://mcp.notion.com/mcp");
    expect(notion.description.length).toBeGreaterThan(0);
  });

  it("authorizes each writer separately through Vercel Connect", async () => {
    const notion = await loadNotion();
    expect(notion.auth.principalType).toBe("user");
    expect(notion.auth.vercelConnect.connector).toBe("mcp.notion.com/notion");
  });

  it("reads the connector UID from NOTION_CONNECTOR when set", async () => {
    const notion = await loadNotion("mcp.notion.com/team-notion");
    expect(notion.auth.vercelConnect.connector).toBe(
      "mcp.notion.com/team-notion"
    );
  });

  it("asks for approval before creating pages, by the qualified tool name", async () => {
    const notion = await loadNotion();
    expect(
      await approvalFor(notion.approval, {
        toolName: "notion__notion-create-pages",
      })
    ).toBe("user-approval");
  });

  it.each([
    "notion__notion-search",
    "notion__notion-fetch",
    "notion__notion-update-page",
    "notion__notion-create-comment",
  ])("lets %s run without a prompt", async (toolName) => {
    const notion = await loadNotion();
    expect(await approvalFor(notion.approval, { toolName })).toBe(
      "not-applicable"
    );
  });
});
