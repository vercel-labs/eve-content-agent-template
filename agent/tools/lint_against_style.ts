import { defineTool } from "eve/tools";
import { z } from "zod";

/**
 * Escape regular-expression metacharacters so a banned word is matched literally.
 *
 * @remarks
 * Banned words are read from a JSON file and interpolated into a `RegExp`. Without escaping,
 * an entry containing metacharacters could raise a syntax error or, worse, a
 * catastrophic-backtracking pattern (ReDoS) evaluated against caller-supplied `text`.
 * Escaping forces a literal, linear-time match.
 *
 * @param value - Raw banned word.
 * @returns The word with all regex metacharacters backslash-escaped.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Maximum draft length accepted, in characters.
 *
 * @remarks
 * Bounds the work done per call and the size of accepted input. Comfortably larger than any
 * realistic draft for the supported surfaces.
 */
const MAX_TEXT_LENGTH = 100_000;

/**
 * Schema for a `banned-words.json` file: a flat array of strings.
 *
 * @remarks
 * Parsed content that does not match (a non-array, or non-string elements) is rejected and
 * treated as an empty list rather than trusted.
 */
const BANNED_WORDS_SCHEMA = z.array(z.string());

/**
 * Tool that checks a draft against the active surface's banned-words list.
 *
 * @remarks
 * The banned-words list lives in the matching style skill at `references/banned-words.json`
 * and is read at runtime through the skill handle. The `surface` input is constrained to a
 * fixed enum, so the resolved skill id and file path can never be influenced by the caller.
 * Any failure to resolve, read, parse, or validate the list is treated as "no banned words"
 * rather than failing the check. Run it before proposing a draft to the writer.
 */
export default defineTool({
  description:
    "Check a draft against the active surface's style rules and return any violations. " +
    "Run before proposing a draft to the writer.",
  inputSchema: z.object({
    surface: z.enum(["blog", "linkedin", "release-notes", "newsletter"]),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
  }),
  /**
   * Scan `text` for any banned word defined by the surface's style skill.
   *
   * @param input - Validated tool input.
   * @param input.surface - Content surface whose style skill supplies the banned-words list.
   * @param input.text - Draft text to scan.
   * @param ctx - Tool runtime context, used to read the skill's reference files.
   * @returns `ok` (true when no banned words are present) and human-readable `violations`.
   */
  async execute({ surface, text }, ctx) {
    let banned: string[] = [];
    try {
      const raw = await ctx
        .getSkill(`${surface}-style`)
        .file("references/banned-words.json")
        .text();
      const parsed = BANNED_WORDS_SCHEMA.safeParse(JSON.parse(raw));
      if (parsed.success) {
        banned = [...new Set(parsed.data.map((w) => w.trim()).filter(Boolean))];
      }
    } catch {
      banned = [];
    }

    const hits = banned.filter((w) =>
      new RegExp(`\\b${escapeRegExp(w)}\\b`, "i").test(text)
    );
    return {
      ok: hits.length === 0,
      violations: hits.map(
        (w) => `Avoid "${w}" per the ${surface} style guide.`
      ),
    };
  },
});
