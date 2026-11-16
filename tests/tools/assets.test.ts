import { del, get, head, list, put } from "@vercel/blob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESERVED_PATH_ERROR } from "#lib/reserved-paths.js";
import deleteAsset from "#tools/delete_asset.js";
import downloadAsset from "#tools/download_asset.js";
import getAssetInfo from "#tools/get_asset_info.js";
import listAssets from "#tools/list_assets.js";
import uploadAsset from "#tools/upload_asset.js";
import { acceptsInput, approvalFor, callTool } from "../helpers/tool.js";
import { toolContext } from "../helpers/tool-context.js";

vi.mock("@vercel/blob", () => ({
  del: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}));

const STORE = "https://store123.private.blob.vercel-storage.com";
const ASSET_URL = `${STORE}/drafts/post.md`;
const MEMORY_URL = `${STORE}/eve/memory/file/someone-else.md`;
const UPLOADED_AT = new Date("2026-11-01T10:00:00.000Z");

/**
 * Build the stream a Blob `get` result carries.
 *
 * @param body - The object's bytes or text.
 * @returns A readable stream of the body.
 */
const streamOf = (body: string | Uint8Array): ReadableStream<Uint8Array> =>
  new Blob([body as BlobPart]).stream();

/**
 * Build a successful Blob `get` result.
 *
 * @param contentType - The stored object's content type.
 * @param body - The stored object's bytes or text.
 * @returns A value shaped like the SDK's result for a found object.
 */
const found = (contentType: string, body: string | Uint8Array) =>
  ({
    blob: { contentType },
    statusCode: 200,
    stream: streamOf(body),
  }) as unknown as Awaited<ReturnType<typeof get>>;

beforeEach(() => {
  vi.mocked(del).mockResolvedValue(undefined);
});

describe("upload_asset", () => {
  it("writes text privately, without overwrite or a random suffix by default", async () => {
    vi.mocked(put).mockResolvedValue({
      contentType: "text/markdown",
      pathname: "drafts/post.md",
      url: ASSET_URL,
    } as Awaited<ReturnType<typeof put>>);

    const output = await callTool(
      uploadAsset,
      { content: "# Post", pathname: "drafts/post.md" },
      toolContext()
    );

    expect(put).toHaveBeenCalledExactlyOnceWith("drafts/post.md", "# Post", {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: undefined,
    });
    expect(output).toEqual({
      contentType: "text/markdown",
      pathname: "drafts/post.md",
      success: true,
      url: ASSET_URL,
    });
  });

  it("decodes base64 content to bytes and forwards the explicit options", async () => {
    vi.mocked(put).mockResolvedValue({
      contentType: "image/png",
      pathname: "images/logo-abc.png",
      url: `${STORE}/images/logo-abc.png`,
    } as Awaited<ReturnType<typeof put>>);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    await callTool(
      uploadAsset,
      {
        addRandomSuffix: true,
        allowOverwrite: true,
        content: bytes.toString("base64"),
        contentType: "image/png",
        isBase64: true,
        pathname: "images/logo.png",
      },
      toolContext()
    );

    const [pathname, body, options] = vi.mocked(put).mock.calls[0] ?? [];
    expect(pathname).toBe("images/logo.png");
    expect(Buffer.isBuffer(body) && body.equals(bytes)).toBe(true);
    expect(options).toEqual({
      access: "private",
      addRandomSuffix: true,
      allowOverwrite: true,
      contentType: "image/png",
    });
  });

  it("refuses a reserved path without touching storage", async () => {
    const output = await callTool(
      uploadAsset,
      {
        content: "not a preference",
        pathname: "eve/memory/file/someone-else.md",
      },
      toolContext()
    );

    expect(put).not.toHaveBeenCalled();
    expect(output).toEqual({
      contentType: "unknown",
      error: RESERVED_PATH_ERROR,
      pathname: "eve/memory/file/someone-else.md",
      success: false,
      url: "",
    });
  });

  it("reports a storage failure as a result, not a throw", async () => {
    vi.mocked(put).mockRejectedValue(new Error("blob already exists"));

    const output = await callTool(
      uploadAsset,
      { content: "x", contentType: "text/plain", pathname: "a.txt" },
      toolContext()
    );

    expect(output).toEqual({
      contentType: "text/plain",
      error: "blob already exists",
      pathname: "a.txt",
      success: false,
      url: "",
    });
  });

  it("requires content and a non-empty pathname", async () => {
    expect(
      await acceptsInput(uploadAsset, { content: "x", pathname: "a" })
    ).toBe(true);
    expect(
      await acceptsInput(uploadAsset, { content: "x", pathname: "" })
    ).toBe(false);
    expect(await acceptsInput(uploadAsset, { content: "x" })).toBe(false);
    expect(await acceptsInput(uploadAsset, { pathname: "a" })).toBe(false);
  });
});

describe("list_assets", () => {
  it("returns assets with ISO dates and passes the filter through", async () => {
    vi.mocked(list).mockResolvedValue({
      blobs: [
        {
          pathname: "drafts/post.md",
          size: 120,
          uploadedAt: UPLOADED_AT,
          url: ASSET_URL,
        },
      ],
      cursor: "next-page",
      hasMore: true,
    } as Awaited<ReturnType<typeof list>>);

    const output = await callTool(
      listAssets,
      { limit: 10, prefix: "drafts/" },
      toolContext()
    );

    expect(list).toHaveBeenCalledExactlyOnceWith({
      limit: 10,
      prefix: "drafts/",
    });
    expect(output).toEqual({
      assets: [
        {
          pathname: "drafts/post.md",
          size: 120,
          uploadedAt: "2026-11-01T10:00:00.000Z",
          url: ASSET_URL,
        },
      ],
      count: 1,
      cursor: "next-page",
      hasMore: true,
    });
  });

  it("hides writer memory and counts only what it shows", async () => {
    vi.mocked(list).mockResolvedValue({
      blobs: [
        {
          pathname: "eve/memory/file/alice.md",
          size: 1,
          uploadedAt: UPLOADED_AT,
          url: `${STORE}/eve/memory/file/alice.md`,
        },
        {
          pathname: "drafts/post.md",
          size: 2,
          uploadedAt: UPLOADED_AT,
          url: ASSET_URL,
        },
        {
          pathname: "writer-preferences/bob.json",
          size: 3,
          uploadedAt: UPLOADED_AT,
          url: `${STORE}/writer-preferences/bob.json`,
        },
      ],
      hasMore: false,
    } as Awaited<ReturnType<typeof list>>);

    const output = await callTool(listAssets, {}, toolContext());

    expect(output.count).toBe(1);
    expect(output.assets.map((asset) => asset.pathname)).toEqual([
      "drafts/post.md",
    ]);
    expect(JSON.stringify(output)).not.toContain("memory");
    expect(JSON.stringify(output)).not.toContain("writer-preferences");
  });

  it("reports a storage failure as an empty list with an error", async () => {
    vi.mocked(list).mockRejectedValue(new Error("store not found"));

    await expect(callTool(listAssets, {}, toolContext())).resolves.toEqual({
      assets: [],
      count: 0,
      error: "store not found",
      hasMore: false,
    });
  });

  it("bounds the limit to 1-1000 whole numbers", async () => {
    const accepts = (limit: number) => acceptsInput(listAssets, { limit });
    expect(await accepts(1)).toBe(true);
    expect(await accepts(1000)).toBe(true);
    expect(await accepts(0)).toBe(false);
    expect(await accepts(1001)).toBe(false);
    expect(await accepts(1.5)).toBe(false);
  });
});

describe("get_asset_info", () => {
  it("returns the asset's metadata", async () => {
    vi.mocked(head).mockResolvedValue({
      contentType: "text/markdown",
      pathname: "drafts/post.md",
      size: 120,
      uploadedAt: UPLOADED_AT,
      url: ASSET_URL,
    } as Awaited<ReturnType<typeof head>>);

    const output = await callTool(
      getAssetInfo,
      { url: ASSET_URL },
      toolContext()
    );

    expect(head).toHaveBeenCalledExactlyOnceWith(ASSET_URL);
    expect(output).toEqual({
      contentType: "text/markdown",
      exists: true,
      pathname: "drafts/post.md",
      size: 120,
      uploadedAt: "2026-11-01T10:00:00.000Z",
      url: ASSET_URL,
    });
  });

  it("reports a missing asset as exists: false", async () => {
    vi.mocked(head).mockRejectedValue(
      new Error("The requested blob does not exist")
    );

    await expect(
      callTool(getAssetInfo, { url: ASSET_URL }, toolContext())
    ).resolves.toEqual({
      error: "The requested blob does not exist",
      exists: false,
      url: ASSET_URL,
    });
  });

  it("refuses a reserved URL without touching storage", async () => {
    const output = await callTool(
      getAssetInfo,
      { url: MEMORY_URL },
      toolContext()
    );

    expect(head).not.toHaveBeenCalled();
    expect(output).toEqual({
      error: RESERVED_PATH_ERROR,
      exists: false,
      url: MEMORY_URL,
    });
  });
});

describe("download_asset", () => {
  it("returns text content raw", async () => {
    vi.mocked(get).mockResolvedValue(found("text/markdown", "# Post"));

    const output = await callTool(
      downloadAsset,
      { url: ASSET_URL },
      toolContext()
    );

    expect(get).toHaveBeenCalledExactlyOnceWith(ASSET_URL, {
      access: "private",
    });
    expect(output).toEqual({
      content: "# Post",
      contentType: "text/markdown",
      isBase64: false,
      success: true,
      url: ASSET_URL,
    });
  });

  it("treats JSON as text", async () => {
    vi.mocked(get).mockResolvedValue(found("application/json", '{"a":1}'));

    const output = await callTool(
      downloadAsset,
      { url: `${STORE}/data.json` },
      toolContext()
    );

    expect(output).toMatchObject({ content: '{"a":1}', isBase64: false });
  });

  it("returns binary content base64-encoded", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    vi.mocked(get).mockResolvedValue(found("image/png", bytes));

    const output = await callTool(
      downloadAsset,
      { url: `${STORE}/images/logo.png` },
      toolContext()
    );

    expect(output).toMatchObject({
      content: Buffer.from(bytes).toString("base64"),
      contentType: "image/png",
      isBase64: true,
      success: true,
    });
  });

  it.each([
    "https://example.com/drafts/post.md",
    "http://169.254.169.254/latest/meta-data",
    "https://blob.vercel-storage.com.evil.example/a.md",
    "https://evilblob.vercel-storage.com/a.md",
  ])(
    "refuses %s, which isn't a Vercel Blob host, without fetching it",
    async (url) => {
      const output = await callTool(downloadAsset, { url }, toolContext());

      expect(output.success).toBe(false);
      expect(output.error).toContain("only Vercel Blob URLs");
      expect(get).not.toHaveBeenCalled();
    }
  );

  it("refuses a reserved URL without touching storage", async () => {
    const output = await callTool(
      downloadAsset,
      { url: MEMORY_URL },
      toolContext()
    );

    expect(get).not.toHaveBeenCalled();
    expect(output).toEqual({
      error: RESERVED_PATH_ERROR,
      success: false,
      url: MEMORY_URL,
    });
  });

  it("reports a response that carries no content as missing", async () => {
    vi.mocked(get).mockResolvedValue({
      blob: { contentType: "text/markdown" },
      statusCode: 304,
      stream: null,
    } as unknown as Awaited<ReturnType<typeof get>>);

    await expect(
      callTool(downloadAsset, { url: ASSET_URL }, toolContext())
    ).resolves.toEqual({
      error: "Asset not found.",
      success: false,
      url: ASSET_URL,
    });
  });

  it("reports a missing asset", async () => {
    vi.mocked(get).mockResolvedValue(null);

    await expect(
      callTool(downloadAsset, { url: ASSET_URL }, toolContext())
    ).resolves.toEqual({
      error: "Asset not found.",
      success: false,
      url: ASSET_URL,
    });
  });

  it("reports a storage failure as a result, not a throw", async () => {
    vi.mocked(get).mockRejectedValue(new Error("access denied"));

    await expect(
      callTool(downloadAsset, { url: ASSET_URL }, toolContext())
    ).resolves.toEqual({
      error: "access denied",
      success: false,
      url: ASSET_URL,
    });
  });
});

describe("delete_asset", () => {
  it("always requires the writer's approval", async () => {
    expect(
      await approvalFor(deleteAsset.approval, {
        toolInput: { url: ASSET_URL },
        toolName: "delete_asset",
      })
    ).toBe("user-approval");
  });

  it("deletes the asset by URL", async () => {
    const output = await callTool(
      deleteAsset,
      { url: ASSET_URL },
      toolContext()
    );

    expect(del).toHaveBeenCalledExactlyOnceWith(ASSET_URL);
    expect(output).toEqual({ deleted: true, success: true, url: ASSET_URL });
  });

  it("refuses a reserved URL without touching storage", async () => {
    const output = await callTool(
      deleteAsset,
      { url: MEMORY_URL },
      toolContext()
    );

    expect(del).not.toHaveBeenCalled();
    expect(output).toEqual({
      deleted: false,
      error: RESERVED_PATH_ERROR,
      success: false,
      url: MEMORY_URL,
    });
  });

  it("reports a storage failure as a result, not a throw", async () => {
    vi.mocked(del).mockRejectedValue(new Error("forbidden"));

    await expect(
      callTool(deleteAsset, { url: ASSET_URL }, toolContext())
    ).resolves.toEqual({
      deleted: false,
      error: "forbidden",
      success: false,
      url: ASSET_URL,
    });
  });
});

describe("asset tool URL inputs", () => {
  it.each([
    ["delete_asset", deleteAsset],
    ["download_asset", downloadAsset],
    ["get_asset_info", getAssetInfo],
  ] as const)("%s accepts only a well-formed URL", async (_name, tool) => {
    expect(await acceptsInput(tool, { url: ASSET_URL })).toBe(true);
    expect(await acceptsInput(tool, { url: "drafts/post.md" })).toBe(false);
    expect(await acceptsInput(tool, {})).toBe(false);
  });
});
