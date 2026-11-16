import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SURFACES } from "#lib/surfaces.generated.js";

const run = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMPILE_TIMEOUT_MS = 60_000;

/**
 * What the compiler needs from the project: the agent, and the package manifest whose `imports`
 * map resolves `#lib/...` specifiers.
 */
const COMPILED_PATHS = ["agent", "package.json", "tsconfig.json"] as const;

/**
 * The one diagnostic that says nothing about the project.
 *
 * @remarks
 * eve reports it when it can't reach the AI Gateway model catalog, which is the case offline.
 * Every other diagnostic, warning or error, fails the suite.
 */
const CATALOG_UNAVAILABLE = "compile/model-metadata-unavailable";

/**
 * JSON Schema for one tool's input, as eve sends it to the model.
 */
interface ToolInputSchema {
  readonly properties: Readonly<
    Record<
      string,
      {
        readonly enum?: readonly string[];
        readonly maxLength?: number;
        readonly minLength?: number;
      }
    >
  >;
  readonly required?: readonly string[];
}

/**
 * The parts of `eve info --json` these tests read.
 */
interface AgentInfo {
  readonly artifacts: { readonly diagnostics: string };
  readonly channels: readonly {
    readonly method: string;
    readonly urlPath: string;
  }[];
  readonly schedules: readonly unknown[];
  readonly skills: readonly string[];
  readonly status: string;
  readonly subagents: readonly string[];
  readonly toolInputSchemas: {
    readonly root: Readonly<Record<string, ToolInputSchema>>;
    readonly subagents: Readonly<
      Record<string, Readonly<Record<string, ToolInputSchema>>>
    >;
  };
  readonly tools: readonly string[];
}

/**
 * One entry of the diagnostics file the compiler writes.
 */
interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: string;
}

/**
 * What eve discovers from `agent/`: the surface the model and callers actually get.
 *
 * @remarks
 * Runs eve's own compiler through `eve info --json`, so these tests fail when a file under
 * `agent/` stops compiling, when an eve upgrade adds a default tool the agent hasn't decided on,
 * or when a tool is added or removed without updating the list here.
 *
 * The compiler runs on a temporary copy of the project, so it starts from an empty build cache
 * every time and never touches the working tree's `.eve/`. It runs with `EVE_MOCK_MODEL=1`: the
 * discovered surface doesn't depend on the models, and with real model ids the compiler needs the
 * AI Gateway model catalog, which would make the result depend on the network. `eve info` may
 * still try to fetch that catalog; the tests pass whether or not it can.
 */
describe("discovered agent surface", () => {
  let copy: string;
  let info: AgentInfo;
  let diagnostics: readonly Diagnostic[];

  beforeAll(async () => {
    copy = await mkdtemp(join(tmpdir(), "content-agent-discovery-"));
    await Promise.all([
      ...COMPILED_PATHS.map((path) =>
        cp(join(ROOT, path), join(copy, path), { recursive: true })
      ),
      symlink(join(ROOT, "node_modules"), join(copy, "node_modules"), "dir"),
    ]);
    const { stdout } = await run(
      process.execPath,
      [join(copy, "node_modules", "eve", "bin", "eve.js"), "info", "--json"],
      { cwd: copy, env: { ...process.env, EVE_MOCK_MODEL: "1" } }
    );
    info = JSON.parse(stdout) as AgentInfo;
    ({ diagnostics } = JSON.parse(
      await readFile(info.artifacts.diagnostics, "utf8")
    ) as { diagnostics: Diagnostic[] });
  }, COMPILE_TIMEOUT_MS);

  afterAll(async () => {
    await rm(copy, { force: true, recursive: true });
  });

  it("compiles with no errors or warnings of its own", () => {
    expect(info.status).toBe("ready");
    expect(
      diagnostics.filter(
        (diagnostic) => diagnostic.code !== CATALOG_UNAVAILABLE
      )
    ).toEqual([]);
  });

  it("gives the root agent exactly these tools", () => {
    expect([...info.tools].sort()).toEqual([
      "agent",
      "check_style",
      "delete_asset",
      "detect_surface",
      "download_asset",
      "get_asset_info",
      "list_assets",
      "read_file",
      "research",
      "review",
      "upload_asset",
      "web_fetch",
      "web_search",
    ]);
  });

  it("keeps the shell and file-writing built-ins away from the root agent", () => {
    for (const tool of ["bash", "edit_file", "write_file"]) {
      expect(info.tools).not.toContain(tool);
    }
  });

  it("has one style skill per surface", () => {
    expect([...info.skills].sort()).toEqual(
      SURFACES.map((surface) => `${surface}-style`).sort()
    );
  });

  it("declares the researcher and reviewer, each with only its own tool schemas", () => {
    // `web_search` runs at the model provider and has no input schema, so it isn't listed here;
    // tests/agents.test.ts checks the researcher's tool files.
    expect([...info.subagents].sort()).toEqual(["researcher", "reviewer"]);
    expect(Object.keys(info.toolInputSchemas.subagents.researcher)).toEqual([
      "web_fetch",
    ]);
    expect(Object.keys(info.toolInputSchemas.subagents.reviewer)).toEqual([
      "get_surface_rubric",
    ]);
  });

  it("tells the model the same input limits the tools enforce", () => {
    const { root } = info.toolInputSchemas;
    expect(root.research.properties.message).toMatchObject({
      maxLength: 15_000,
      minLength: 1,
    });
    expect(root.research.properties.depth.enum).toEqual([
      "quick",
      "standard",
      "deep",
    ]);
    expect(root.research.required).toEqual(["message"]);
    expect(root.check_style.properties.text).toMatchObject({
      maxLength: 100_000,
      minLength: 1,
    });
    expect(root.check_style.properties.surface.enum).toEqual([...SURFACES]);
    expect(root.detect_surface.properties.request).toMatchObject({
      maxLength: 8000,
      minLength: 1,
    });
  });

  it("serves the session API and the Slack webhook, and no schedules", () => {
    const routes = info.channels.map(
      (channel) => `${channel.method} ${channel.urlPath}`
    );
    expect(routes).toContain("POST /eve/v1/session");
    expect(routes).toContain("POST /eve/v1/slack");
    expect(info.schedules).toEqual([]);
  });
});
