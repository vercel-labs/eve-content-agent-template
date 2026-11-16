import { describe, expect, it } from "vitest";
import { SURFACES } from "#lib/surfaces.generated.js";
import { REVIEWER_RUBRIC } from "#subagents/reviewer/lib/rubric.generated.js";
import getSurfaceRubric from "#subagents/reviewer/tools/get_surface_rubric.js";
import { acceptsInput, callTool } from "../helpers/tool.js";
import { toolContext } from "../helpers/tool-context.js";

describe("get_surface_rubric", () => {
  it.each(SURFACES)(
    "returns the house lists plus the %s rubric",
    async (surface) => {
      const output = await callTool(
        getSurfaceRubric,
        { surface },
        toolContext()
      );

      expect(output).toEqual({
        aiPhrasesToAvoid: REVIEWER_RUBRIC.house.aiPhrasesToAvoid,
        bestPractices: REVIEWER_RUBRIC.surfaces[surface].bestPractices,
        plainEnglishAlternatives:
          REVIEWER_RUBRIC.house.plainEnglishAlternatives,
        specs: REVIEWER_RUBRIC.surfaces[surface].specs,
      });
      for (const section of Object.values(output)) {
        expect(section.trim().length).toBeGreaterThan(0);
      }
    }
  );

  it("accepts only known surfaces", async () => {
    expect(await acceptsInput(getSurfaceRubric, { surface: "tiktok" })).toBe(
      false
    );
    expect(await acceptsInput(getSurfaceRubric, {})).toBe(false);
  });
});
