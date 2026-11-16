import type { WorkflowToolContext } from "eve/tools";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { BANNED_WORDS } from "#lib/banned-words.generated.js";
import { findBannedWords } from "#lib/banned-words.js";
import type {
  DECISION_MODEL,
  DEEP_RESEARCH_MODEL,
  REVIEW_MODEL,
  ROOT_MODEL,
  STANDARD_RESEARCH_MODEL,
} from "#lib/models.js";
import { isReservedPath, isReservedUrl } from "#lib/reserved-paths.js";
import type { REVIEW_SCHEMA } from "#lib/review-schema.js";
import { askSubagent } from "#lib/subagent.js";
import type { SURFACES, Surface } from "#lib/surfaces.generated.js";
import type getSurfaceRubric from "#subagents/reviewer/tools/get_surface_rubric.js";
import checkStyle from "#tools/check_style.js";
import type deleteAsset from "#tools/delete_asset.js";
import type detectSurface from "#tools/detect_surface.js";
import type downloadAsset from "#tools/download_asset.js";
import type listAssets from "#tools/list_assets.js";
import research from "#tools/research.js";
import type review from "#tools/review.js";
import type uploadAsset from "#tools/upload_asset.js";
import { callTool } from "./helpers/tool.js";

/**
 * The input type a tool's `execute` accepts.
 */
type InputOf<TTool extends { execute: (input: never, ctx: never) => unknown }> =
  Parameters<TTool["execute"]>[0];

/**
 * The output type a tool's `execute` resolves to, with the streaming form removed.
 */
type OutputOf<
  TTool extends { execute: (input: never, ctx: never) => unknown },
> = Exclude<Awaited<ReturnType<TTool["execute"]>>, AsyncIterable<unknown>>;

type Review = z.infer<typeof REVIEW_SCHEMA>;

/**
 * The review verdict, written out so a schema change has to be made here too.
 */
interface ReviewShape {
  issues: {
    fix: string;
    quote: string;
    rule: string;
    severity: "high" | "low" | "medium";
  }[];
  verdict: "ready" | "revise";
}

/**
 * Compile-time contracts. `pnpm typecheck` is what enforces this file: every `expectTypeOf`
 * is a type assertion and every `@ts-expect-error` must sit on a real type error. At runtime the
 * assertions are no-ops, so the tests only confirm the file loads. A plain `defineTool` tool
 * keeps its `execute` function's own, narrower return type, so those results are checked with
 * `toExtend`; a workflow tool's result is its output schema's type.
 */
describe("types: surfaces and models", () => {
  it("derives Surface from the generated SURFACES tuple, as a closed set", () => {
    expectTypeOf<(typeof SURFACES)[number]>().toEqualTypeOf<Surface>();
    expectTypeOf<string>().not.toExtend<Surface>();
    expectTypeOf<typeof BANNED_WORDS>().toEqualTypeOf<
      Readonly<Record<Surface, readonly string[]>>
    >();
  });

  it("keeps each model id a literal type, not a plain string", () => {
    expectTypeOf<string>().not.toExtend<typeof ROOT_MODEL>();
    expectTypeOf<string>().not.toExtend<typeof REVIEW_MODEL>();
    expectTypeOf<string>().not.toExtend<typeof DEEP_RESEARCH_MODEL>();
    expectTypeOf<string>().not.toExtend<typeof STANDARD_RESEARCH_MODEL>();
    expectTypeOf<string>().not.toExtend<typeof DECISION_MODEL>();
    expectTypeOf<typeof ROOT_MODEL>().toExtend<`${string}/${string}`>();
  });
});

describe("types: library helpers", () => {
  it("types the banned-words matcher and the reserved-path guards", () => {
    expectTypeOf(findBannedWords).toEqualTypeOf<
      (surface: Surface, text: string) => string[]
    >();
    expectTypeOf(isReservedPath).toEqualTypeOf<(pathname: string) => boolean>();
    expectTypeOf(isReservedUrl).toEqualTypeOf<(url: string) => boolean>();
  });

  it("rejects an unknown surface at compile time", () => {
    const misuse = () =>
      // @ts-expect-error -- "tiktok" is not a Surface.
      findBannedWords("tiktok", "text");
    expect(misuse).toBeTypeOf("function");
  });

  it("types askSubagent's result from the schema it is given", () => {
    const ask = (ctx: Pick<WorkflowToolContext, "abortSignal" | "agent">) =>
      askSubagent(ctx, "reviewer", "message", z.object({ score: z.number() }));
    expectTypeOf(ask).returns.resolves.toEqualTypeOf<{ score: number }>();
  });

  it("types the review verdict", () => {
    expectTypeOf<Review>().toEqualTypeOf<ReviewShape>();
  });
});

describe("types: tool inputs", () => {
  it("infers each tool's input from its schema", () => {
    expectTypeOf<InputOf<typeof checkStyle>>().toEqualTypeOf<{
      surface: Surface;
      text: string;
    }>();
    expectTypeOf<InputOf<typeof detectSurface>>().toEqualTypeOf<{
      request: string;
    }>();
    expectTypeOf<InputOf<typeof research>>().toEqualTypeOf<{
      depth?: "deep" | "quick" | "standard" | undefined;
      message: string;
    }>();
    expectTypeOf<InputOf<typeof review>>().toEqualTypeOf<{ message: string }>();
    expectTypeOf<InputOf<typeof getSurfaceRubric>>().toEqualTypeOf<{
      surface: Surface;
    }>();
    expectTypeOf<InputOf<typeof deleteAsset>>().toEqualTypeOf<{
      url: string;
    }>();
    expectTypeOf<InputOf<typeof downloadAsset>>().toEqualTypeOf<{
      url: string;
    }>();
    expectTypeOf<InputOf<typeof listAssets>>().toEqualTypeOf<{
      limit?: number | undefined;
      prefix?: string | undefined;
    }>();
    expectTypeOf<InputOf<typeof uploadAsset>>().toEqualTypeOf<{
      addRandomSuffix?: boolean | undefined;
      allowOverwrite?: boolean | undefined;
      content: string;
      contentType?: string | undefined;
      isBase64?: boolean | undefined;
      pathname: string;
    }>();
  });

  it("rejects malformed tool input at compile time", () => {
    const misuse = (ctx: WorkflowToolContext) => [
      // @ts-expect-error -- "tiktok" is not a Surface.
      callTool(checkStyle, { surface: "tiktok", text: "draft" }, ctx),
      // @ts-expect-error -- `text` is required.
      callTool(checkStyle, { surface: "blog" }, ctx),
      // @ts-expect-error -- "exhaustive" is not a research depth.
      callTool(research, { depth: "exhaustive", message: "question" }, ctx),
      // @ts-expect-error -- `message` must be a string.
      callTool(research, { message: 42 }, ctx),
    ];
    expect(misuse).toBeTypeOf("function");
  });
});

describe("types: tool outputs", () => {
  it("types check_style's result, including the optional review", () => {
    type Output = OutputOf<typeof checkStyle>;
    expectTypeOf<Output["escalation"]>().toEqualTypeOf<
      "decide_error" | "none" | "uncertain"
    >();
    expectTypeOf<Output["ok"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Output["violations"]>().toEqualTypeOf<string[]>();
    expectTypeOf<Output["checks"][number]>().toEqualTypeOf<{
      passed: boolean;
      probability: number;
      rule: string;
    }>();
    expectTypeOf<Output["review"]>().toEqualTypeOf<ReviewShape | undefined>();
  });

  it("keeps detect_surface's result within its declared output", () => {
    type Output = OutputOf<typeof detectSurface>;
    expectTypeOf<Output>().toExtend<{
      outcome: "confident" | "decide_error" | "unsure";
      probability: number | null;
      surface: Surface | null;
    }>();
    expectTypeOf<Output["outcome"]>().toEqualTypeOf<
      "confident" | "decide_error" | "unsure"
    >();
    expectTypeOf<
      Extract<Output, { outcome: "confident" }>["surface"]
    >().toEqualTypeOf<Surface>();
    expectTypeOf<
      Extract<Output, { outcome: "decide_error" | "unsure" }>["surface"]
    >().toEqualTypeOf<null>();
  });

  it("types research findings, each with its sources", () => {
    type Finding = OutputOf<typeof research>["findings"][number];
    expectTypeOf<Finding["confidence"]>().toEqualTypeOf<
      "high" | "low" | "medium"
    >();
    expectTypeOf<Finding["sources"]>().toEqualTypeOf<
      { title: string; url: string }[]
    >();
    expectTypeOf<OutputOf<typeof research>["gaps"]>().toEqualTypeOf<string[]>();
  });

  it("types the review tool's result as the review verdict", () => {
    expectTypeOf<OutputOf<typeof review>>().toEqualTypeOf<ReviewShape>();
  });

  it("types the asset tools' results", () => {
    expectTypeOf<OutputOf<typeof deleteAsset>>().toExtend<{
      deleted: boolean;
      error?: string | undefined;
      success: boolean;
      url: string;
    }>();
    expectTypeOf<
      OutputOf<typeof listAssets>["assets"][number]
    >().toEqualTypeOf<{
      pathname: string;
      size: number;
      uploadedAt: string;
      url: string;
    }>();
  });
});
