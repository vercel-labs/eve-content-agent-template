import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "#lib/banned-words.generated.js";
import { findBannedWords, findListedWords } from "#lib/banned-words.js";
import { SURFACES } from "#lib/surfaces.generated.js";

/**
 * A fixed list for the matching rules, so these tests don't depend on what the style skills ban.
 */
const WORDS = [
  "leverage",
  "synergy",
  "game-changer",
  "excited to announce",
  "agree?",
  "don't miss",
  "—",
  "c++",
  "a.b",
];

describe("findListedWords", () => {
  it("matches case-insensitively and reports the list's own spelling", () => {
    expect(findListedWords(WORDS, "We LEVERAGE Synergy to ship.")).toEqual([
      "leverage",
      "synergy",
    ]);
  });

  it("returns hits in list order, not text order, each at most once", () => {
    expect(
      findListedWords(WORDS, "Synergy! We leverage synergy, then leverage it.")
    ).toEqual(["leverage", "synergy"]);
  });

  it("matches whole words only", () => {
    expect(findListedWords(WORDS, "The leveraged buyout closed.")).toEqual([]);
    expect(findListedWords(WORDS, "Releverage it.")).toEqual([]);
    expect(findListedWords(WORDS, "Call it synergy2.")).toEqual([]);
  });

  it("matches a word next to punctuation or at the edges of the text", () => {
    expect(findListedWords(WORDS, "leverage")).toEqual(["leverage"]);
    expect(findListedWords(WORDS, "(leverage), then stop.")).toEqual([
      "leverage",
    ]);
    expect(findListedWords(WORDS, "Line one\nsynergy\nline three")).toEqual([
      "synergy",
    ]);
  });

  it("matches hyphenated entries and multi-word phrases", () => {
    expect(findListedWords(WORDS, "A real game-changer.")).toEqual([
      "game-changer",
    ]);
    expect(findListedWords(WORDS, "I'm excited to announce it.")).toEqual([
      "excited to announce",
    ]);
    expect(findListedWords(WORDS, "I'm excited to announcements.")).toEqual([]);
  });

  it("matches an entry that ends in punctuation literally", () => {
    expect(findListedWords(WORDS, "Great launch. Agree?")).toEqual(["agree?"]);
    expect(findListedWords(WORDS, "We agree on this.")).toEqual([]);
    expect(findListedWords(WORDS, "Do you disagree?")).toEqual([]);
  });

  it("matches an entry containing an apostrophe", () => {
    expect(findListedWords(WORDS, "Don't miss this issue")).toEqual([
      "don't miss",
    ]);
  });

  it("matches an entry made only of punctuation, anywhere", () => {
    expect(findListedWords(WORDS, "Fast—and simple")).toEqual(["—"]);
  });

  it("treats regex metacharacters in an entry as literal text", () => {
    expect(findListedWords(WORDS, "Written in C++ last year.")).toEqual([
      "c++",
    ]);
    expect(findListedWords(WORDS, "Written in C last year.")).toEqual([]);
    expect(findListedWords(WORDS, "See section a.b for details.")).toEqual([
      "a.b",
    ]);
    expect(findListedWords(WORDS, "See section axb for details.")).toEqual([]);
  });

  it("returns nothing for clean text, empty text, or an empty list", () => {
    expect(findListedWords(WORDS, "Export reports in one click.")).toEqual([]);
    expect(findListedWords(WORDS, "")).toEqual([]);
    expect(findListedWords([], "leverage synergy")).toEqual([]);
  });

  it("handles a maximum-length draft", () => {
    const draft = `${"lever ".repeat(16_666)}synergy`;
    expect(draft.length).toBeGreaterThan(99_000);
    expect(findListedWords(WORDS, draft)).toEqual(["synergy"]);
  });
});

describe("findBannedWords", () => {
  it.each(SURFACES)(
    "finds every entry of the %s list when it stands alone",
    (surface) => {
      for (const word of BANNED_WORDS[surface]) {
        expect(findBannedWords(surface, `Start ${word} end`)).toContain(word);
      }
    }
  );

  it.each(SURFACES)(
    "reports a draft that uses the whole %s list, in list order",
    (surface) => {
      const draft = [...BANNED_WORDS[surface]].reverse().join(" ... ");
      expect(findBannedWords(surface, draft)).toEqual([
        ...BANNED_WORDS[surface],
      ]);
    }
  );

  it("applies only the requested surface's list", () => {
    for (const surface of SURFACES) {
      for (const other of SURFACES) {
        const own = new Set<string>(BANNED_WORDS[surface]);
        const foreign = BANNED_WORDS[other].filter((word) => !own.has(word));
        const hits = findBannedWords(surface, foreign.join(" ... "));
        expect(hits.filter((word) => !own.has(word))).toEqual([]);
      }
    }
  });

  it.each(SURFACES)("finds nothing in an empty %s draft", (surface) => {
    expect(findBannedWords(surface, "")).toEqual([]);
  });
});
