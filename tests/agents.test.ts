import { disableTool } from "eve/tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DECISION_MODEL,
  DEEP_RESEARCH_MODEL,
  REVIEW_MODEL,
  ROOT_MODEL,
  STANDARD_RESEARCH_MODEL,
} from "#lib/models.js";

const GATEWAY_ID = /^[a-z0-9-]+\/[a-z0-9][a-z0-9.-]*$/;

/**
 * Import an agent definition fresh, under a chosen `EVE_MOCK_MODEL` setting.
 *
 * @remarks
 * `agent/lib/mock-model.ts` reads the variable once at module load, so the module registry is
 * reset before each import.
 *
 * @param path - The agent module, relative to this file.
 * @param mock - The value for `EVE_MOCK_MODEL`, or `undefined` to leave it unset.
 * @returns The module's default export.
 */
const loadAgent = async (path: string, mock?: string) => {
  vi.resetModules();
  vi.stubEnv("EVE_MOCK_MODEL", mock);
  const module: { default: Record<string, unknown> } = await import(path);
  return module.default;
};

afterEach(() => {
  vi.resetModules();
});

describe("model ids", () => {
  it("are all AI Gateway `provider/model` ids", () => {
    for (const id of [
      DECISION_MODEL,
      DEEP_RESEARCH_MODEL,
      REVIEW_MODEL,
      ROOT_MODEL,
      STANDARD_RESEARCH_MODEL,
    ]) {
      expect(id).toMatch(GATEWAY_ID);
    }
  });

  it("gives the researcher two different models to route between", () => {
    expect(DEEP_RESEARCH_MODEL).not.toBe(STANDARD_RESEARCH_MODEL);
  });
});

describe("root agent", () => {
  it("uses the root model and nothing else", async () => {
    expect(await loadAgent("../agent/agent.js")).toEqual({ model: ROOT_MODEL });
  });

  it.each(["0", "true", ""])(
    "stays on the real model when EVE_MOCK_MODEL is %j",
    async (value) => {
      const agent = await loadAgent("../agent/agent.js", value);
      expect(agent.model).toBe(ROOT_MODEL);
    }
  );

  it("swaps in the scripted mock only when EVE_MOCK_MODEL is 1", async () => {
    const agent = await loadAgent("../agent/agent.js", "1");
    expect(agent.model).toMatchObject({ provider: "eve-mock" });
  });
});

describe("researcher subagent", () => {
  it("is hidden from the model and has no built-in tools", async () => {
    const agent = await loadAgent("../agent/subagents/researcher/agent.js");
    expect(agent.tool).toBe(false);
    expect(agent.defaultTools).toBe(false);
    expect(agent.description).toEqual(expect.stringContaining("Research"));
  });

  it("routes its model per call instead of pinning one", async () => {
    const agent = await loadAgent("../agent/subagents/researcher/agent.js");
    expect(typeof agent.model).toBe("object");
    expect(agent.model).not.toHaveProperty("modelId");
  });

  it("uses a mock model under EVE_MOCK_MODEL=1, with the same isolation", async () => {
    const agent = await loadAgent(
      "../agent/subagents/researcher/agent.js",
      "1"
    );
    expect(agent.model).toMatchObject({ provider: "eve-mock" });
    expect(agent.tool).toBe(false);
    expect(agent.defaultTools).toBe(false);
  });

  it("adds back only web search, through Parallel, and web fetch", async () => {
    const search = await import("#subagents/researcher/tools/web_search.js");
    const fetchTool = await import("#subagents/researcher/tools/web_fetch.js");
    const builtInFetch = await import("eve/tools/web_fetch");

    expect(search.default).toMatchObject({ provider: "parallel" });
    expect(fetchTool.default).toBe(builtInFetch.default);
  });
});

describe("reviewer subagent", () => {
  it("is hidden from the model, has no built-in tools, and runs the review model", async () => {
    const agent = await loadAgent("../agent/subagents/reviewer/agent.js");
    expect(agent).toMatchObject({
      defaultTools: false,
      model: REVIEW_MODEL,
      tool: false,
    });
    expect(agent.description).toEqual(expect.stringContaining("Review"));
  });

  it("uses a mock model under EVE_MOCK_MODEL=1", async () => {
    const agent = await loadAgent("../agent/subagents/reviewer/agent.js", "1");
    expect(agent.model).toMatchObject({ provider: "eve-mock" });
  });
});

describe("built-in tools the root agent turns off", () => {
  it.each(["bash", "edit_file", "write_file"])(
    "%s exports eve's disabled-tool marker",
    async (name) => {
      const module: { default: unknown } = await import(
        `../agent/tools/${name}.ts`
      );
      expect(module.default).toStrictEqual(disableTool());
    }
  );
});
