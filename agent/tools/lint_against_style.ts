import { defineTool } from "eve/tools";
import { z } from "zod";
import { BANNED_WORDS } from "../lib/banned-words.generated.js";
import { SURFACES } from "../lib/surfaces.generated.js";

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

/** Matches when a string starts with an ASCII word character. */
const STARTS_WITH_WORD = /^\w/;

/** Matches when a string ends with an ASCII word character. */
const ENDS_WITH_WORD = /\w$/;

/**
 * Build a case-insensitive matcher for one banned entry.
 *
 * @remarks
 * Anchors a word boundary (`\b`) only on a side that begins or ends with a word character, so
 * ordinary words match whole-word (`just`, never `adjust`), while an entry that starts or ends
 * with punctuation or a symbol (an em dash, `etc.`) still matches literally instead of silently
 * never matching — `\b` only exists next to a word character. The entry is escaped first, so the
 * pattern stays a linear-time literal (no ReDoS) whatever it contains.
 *
 * @param word - A trimmed, non-empty banned entry.
 * @returns A `RegExp` that matches the entry within draft text.
 */
const bannedWordMatcher = (word: string): RegExp => {
  const left = STARTS_WITH_WORD.test(word) ? "\\b" : "";
  const right = ENDS_WITH_WORD.test(word) ? "\\b" : "";
  return new RegExp(`${left}${escapeRegExp(word)}${right}`, "i");
};

/**
 * Maximum draft length accepted, in characters.
 *
 * @remarks
 * Bounds the work done per call and the size of accepted input. Comfortably larger than any
 * realistic draft for the supported surfaces.
 */
const MAX_TEXT_LENGTH = 100_000;

/**
 * Result shape: whether the draft is clean, and a human-readable note per banned word found.
 *
 * @remarks
 * Declared as the tool's `outputSchema` so eve validates and types the `execute` return.
 */
const OUTPUT_SCHEMA = z.object({
  ok: z.boolean(),
  violations: z.array(z.string()),
});

/**
 * Tool that checks a draft against the active surface's banned-words list.
 *
 * @remarks
 * The banned-words list lives in the matching style skill at `references/banned-words.json`
 * (the source of truth the model also reads). Tool code can't read skill files at runtime, so
 * `scripts/sync-shared.mjs` bundles every list — validated, trimmed, and de-duplicated — into
 * {@link BANNED_WORDS} at build time. The `surface` input is constrained to the generated
 * {@link SURFACES} enum, so the caller can only select one of the bundled lists. Run it before
 * proposing a draft to the writer.
 */
export default defineTool({
  description:
    "Check a draft against the active surface's style rules and return any violations. " +
    "Run before proposing a draft to the writer.",
  /**
   * Scan `text` for any banned word defined by the surface's style skill.
   *
   * @param input - Validated tool input.
   * @param input.surface - Content surface whose style skill supplies the banned-words list.
   * @param input.text - Draft text to scan.
   * @returns `ok` (true when no banned words are present) and human-readable `violations`.
   */
  execute({ surface, text }) {
    const hits = BANNED_WORDS[surface].filter((w) =>
      bannedWordMatcher(w).test(text)
    );
    return {
      ok: hits.length === 0,
      violations: hits.map(
        (w) => `Avoid "${w}" per the ${surface} style guide.`
      ),
    };
  },
  inputSchema: z.object({
    surface: z.enum(SURFACES),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
  }),
  outputSchema: OUTPUT_SCHEMA,
});
