import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "#lib/banned-words.generated.js";
import { SURFACE_DESCRIPTIONS, SURFACES } from "#lib/surfaces.generated.js";
import { REVIEWER_RUBRIC } from "#subagents/reviewer/lib/rubric.generated.js";

const run = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "agent", "skills");
const SKILL_SUFFIX = "-style";

/**
 * Everything `scripts/sync-shared.mjs` reads or writes, relative to the repository root.
 */
const SYNCED_PATHS = [
  "scripts/sync-shared.mjs",
  "shared-references",
  "agent/skills",
  "agent/lib/banned-words.generated.ts",
  "agent/lib/surfaces.generated.ts",
  "agent/subagents/reviewer/lib/rubric.generated.ts",
] as const;

/**
 * List every file under a directory, as paths relative to it.
 *
 * @param directory - The directory to walk.
 * @returns The relative file paths, sorted.
 */
const listFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
};

describe("generated modules match their sources", () => {
  it("lists exactly the surfaces that have a style skill folder", async () => {
    const folders = await readdir(SKILLS, { withFileTypes: true });
    const surfaces = folders
      .filter(
        (entry) => entry.isDirectory() && entry.name.endsWith(SKILL_SUFFIX)
      )
      .map((entry) => entry.name.slice(0, -SKILL_SUFFIX.length))
      .sort();

    expect([...SURFACES]).toEqual(surfaces);
    expect(Object.keys(SURFACE_DESCRIPTIONS).sort()).toEqual(surfaces);
    expect(Object.keys(BANNED_WORDS).sort()).toEqual(surfaces);
    expect(Object.keys(REVIEWER_RUBRIC.surfaces).sort()).toEqual(surfaces);
  });

  it.each(SURFACES)(
    "bundles the %s skill's banned-words list unchanged",
    async (surface) => {
      const source: unknown = JSON.parse(
        await readFile(
          join(
            SKILLS,
            `${surface}${SKILL_SUFFIX}`,
            "references",
            "banned-words.json"
          ),
          "utf8"
        )
      );

      expect(BANNED_WORDS[surface]).toEqual(source);
      expect(BANNED_WORDS[surface].length).toBeGreaterThan(0);
    }
  );

  it.each(SURFACES)(
    "takes the %s routing description from the skill's frontmatter",
    async (surface) => {
      const skill = await readFile(
        join(SKILLS, `${surface}${SKILL_SUFFIX}`, "SKILL.md"),
        "utf8"
      );

      expect(SURFACE_DESCRIPTIONS[surface].length).toBeGreaterThan(0);
      expect(skill).toContain(SURFACE_DESCRIPTIONS[surface]);
    }
  );

  it.each([
    ["aiPhrasesToAvoid", "ai-phrases-to-avoid.md"],
    ["plainEnglishAlternatives", "plain-english-alternatives.md"],
  ] as const)(
    "bundles the house %s list, and every skill carries the same copy",
    async (key, file) => {
      const source = await readFile(
        join(ROOT, "shared-references", file),
        "utf8"
      );
      const copies = await Promise.all(
        SURFACES.map((surface) =>
          readFile(
            join(SKILLS, `${surface}${SKILL_SUFFIX}`, "references", file),
            "utf8"
          )
        )
      );

      expect(REVIEWER_RUBRIC.house[key]).toBe(source);
      expect(copies).toEqual(SURFACES.map(() => source));
    }
  );
});

describe("pnpm sync:shared", () => {
  it("changes nothing on a clean checkout", async () => {
    const copy = await mkdtemp(join(tmpdir(), "content-agent-sync-"));
    try {
      await Promise.all(
        SYNCED_PATHS.map(async (path) => {
          await mkdir(dirname(join(copy, path)), { recursive: true });
          await cp(join(ROOT, path), join(copy, path), { recursive: true });
        })
      );

      const { stdout } = await run(
        process.execPath,
        [join(copy, "scripts", "sync-shared.mjs")],
        { cwd: copy }
      );

      expect(stdout).toContain(
        "wrote 0 file(s), updated 0 SKILL.md section(s)"
      );
      expect(stdout).toContain("reviewer rubric: unchanged");
      expect(stdout).toContain("banned words: unchanged");
      const files = (
        await Promise.all(
          ["agent", "shared-references"].map(async (path) =>
            (await listFiles(join(copy, path))).map((file) => join(path, file))
          )
        )
      ).flat();
      const stale = await Promise.all(
        files.map(async (file) => {
          const [synced, committed] = await Promise.all([
            readFile(join(copy, file), "utf8"),
            readFile(join(ROOT, file), "utf8"),
          ]);
          return synced === committed ? null : file;
        })
      );

      expect(files.length).toBeGreaterThan(SURFACES.length);
      expect(
        stale.filter((file) => file !== null),
        "these files are out of date; run `pnpm sync:shared`"
      ).toEqual([]);
    } finally {
      await rm(copy, { force: true, recursive: true });
    }
  });
});
