/**
 * Sync the house-wide writing-style references into every skill.
 *
 * @remarks
 * Source of truth: `shared-references/`. Each listed file is copied verbatim into
 * every `agent/skills/<name>/references/` folder, and a managed `## Shared references`
 * section is (re)generated at the end of each skill's `SKILL.md` so the skill always
 * cites exactly the shared files it carries. Each skill's own `## References` section —
 * and any skill-specific bullets in it — is preserved untouched.
 *
 * The generated copies and SKILL.md sections are committed, so they ship with
 * `eve build` / `eve deploy` and are visible to `eve info` even when the build command
 * does not trigger the pnpm lifecycle hooks.
 *
 * Run it with `pnpm sync:shared`; it also runs automatically on the `predev` and
 * `prebuild` hooks. Edit the originals in `shared-references/` and the bullet text in
 * {@link SHARED_FILES}, never the generated copies or the managed section.
 *
 * @module scripts/sync-shared
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute repository root (one level up from this script). */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Directory holding the canonical shared reference files. */
const sharedDir = resolve(root, "shared-references");

/** Directory holding the per-platform skill folders. */
const skillsDir = resolve(root, "agent", "skills");

/**
 * Shared reference files mirrored into every skill, each with the Markdown bullet that
 * describes it in the generated `## Shared references` section.
 *
 * @remarks
 * Hard-coded rather than derived from input, so the copy set and its prose are fixed and
 * auditable. Adding a house-wide reference is a single entry here plus the file in
 * `shared-references/`; every skill then picks up both the copy and the bullet on the
 * next `pnpm sync:shared`. Bullet `lines` are pre-wrapped to match the surrounding docs.
 */
const SHARED_FILES = [
  {
    name: "ai-phrases-to-avoid.md",
    lines: [
      "- `references/ai-phrases-to-avoid.md` — AI-tell words, phrases, and punctuation to avoid.",
    ],
  },
  {
    name: "plain-english-alternatives.md",
    lines: [
      "- `references/plain-english-alternatives.md` — plain-English swaps for bloated or vague wording.",
    ],
  },
];

/** Heading that introduces the script-managed shared-references section in each SKILL.md. */
const SHARED_SECTION_HEADING = "## Shared references";

/** Heading each SKILL.md must already carry; the managed section is anchored after it. */
const REQUIRED_ANCHOR_HEADING = "## References";

/** Intro paragraph rendered under the managed section heading. */
const SHARED_SECTION_INTRO =
  "Shared global references for all skills in the content agent. These apply regardless of the\ncontent type.";

/**
 * Render the managed `## Shared references` Markdown section from {@link SHARED_FILES}.
 *
 * @returns The section text (heading, intro paragraph, one bullet per shared file),
 *   with no trailing newline.
 */
const renderSharedSection = () =>
  [
    SHARED_SECTION_HEADING,
    "",
    SHARED_SECTION_INTRO,
    "",
    ...SHARED_FILES.map((file) => file.lines.join("\n")),
  ].join("\n");

/** A single, traversal-free path segment: no separators, no `.`/`..` tricks. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** Trailing whitespace, trimmed before the managed section is re-appended. */
const TRAILING_WHITESPACE = /\s*$/;

/**
 * Whether a string is a safe, single path segment.
 *
 * @remarks
 * Rejects empty strings, `.` / `..`, and anything with a path separator or other
 * unexpected character, so a crafted directory or file name can never redirect a read
 * or write outside its intended folder.
 *
 * @param name - A file or directory name (not a path).
 * @returns `true` when `name` is a single, traversal-free segment.
 */
const isSafeSegment = (name) =>
  SAFE_SEGMENT.test(name) && name !== "." && name !== "..";

/**
 * Resolve `target` and assert it stays inside `base`.
 *
 * @param base - Absolute directory the target must remain within.
 * @param target - Path to resolve and check.
 * @returns The resolved absolute path when it is contained by `base`.
 * @throws When `target` resolves outside `base`.
 */
const resolveWithin = (base, target) => {
  const resolved = resolve(target);
  if (resolved !== base && !resolved.startsWith(base + sep)) {
    throw new Error(`refusing to touch path outside ${base}: ${resolved}`);
  }
  return resolved;
};

/**
 * Read every shared source file once.
 *
 * @returns A map of filename to UTF-8 contents.
 * @throws When a configured filename is unsafe or a source file is missing.
 */
const readSources = async () => {
  const sources = new Map();
  for (const { name } of SHARED_FILES) {
    if (!isSafeSegment(name)) {
      throw new Error(`unsafe shared filename: ${name}`);
    }
    const path = resolveWithin(sharedDir, join(sharedDir, name));
    sources.set(name, await readFile(path, "utf8"));
  }
  return sources;
};

/**
 * Write `contents` to `path` only when it differs from what is already there.
 *
 * @remarks
 * Keeps the sync a true no-op on an unchanged run, so the `predev` / `prebuild` hooks do
 * not rewrite (and re-trigger watchers on) identical files, and the reported counts
 * reflect real changes.
 *
 * @param path - Absolute destination path, already checked to live in `skillsDir`.
 * @param contents - Desired file contents.
 * @returns `true` when a write happened.
 */
const writeIfChanged = async (path, contents) => {
  let current;
  try {
    current = await readFile(path, "utf8");
  } catch {
    current = undefined;
  }
  if (current === contents) {
    return false;
  }
  await writeFile(path, contents);
  return true;
};

/**
 * Read one SKILL.md, validate its structure, and compute its desired content with the
 * managed `## Shared references` section (re)generated at the end.
 *
 * @remarks
 * Writes nothing, so every skill can be validated before any file is touched — a single
 * malformed file then aborts the whole run instead of leaving the tree half-synced.
 * Everything above the managed section — including the skill's own `## References` heading
 * and skill-specific bullets — is preserved verbatim. The managed section must be the last
 * heading; a later `##` heading is rejected so the splice can never clobber unrelated
 * content.
 *
 * @param skillFile - Absolute path to a SKILL.md, already checked to live in `skillsDir`.
 * @returns The current file contents and the desired contents.
 * @throws When the file lacks a `## References` anchor, or the managed section is not last.
 */
const planSkillSection = async (skillFile) => {
  const currentMd = await readFile(skillFile, "utf8");
  if (!currentMd.includes(`\n${REQUIRED_ANCHOR_HEADING}`)) {
    throw new Error(
      `${skillFile} has no "${REQUIRED_ANCHOR_HEADING}" section to anchor shared references under`
    );
  }

  const startIdx = currentMd.indexOf(`\n${SHARED_SECTION_HEADING}`);
  let before = currentMd;
  if (startIdx !== -1) {
    if (currentMd.indexOf("\n## ", startIdx + 1) !== -1) {
      throw new Error(
        `${skillFile}: "${SHARED_SECTION_HEADING}" must be the last section`
      );
    }
    before = currentMd.slice(0, startIdx);
  }

  const nextMd = `${before.replace(TRAILING_WHITESPACE, "")}\n\n${renderSharedSection()}\n`;
  return { currentMd, nextMd };
};

/**
 * Copy the shared sources into every skill's `references/` directory and refresh the
 * managed `## Shared references` section in every `SKILL.md`.
 *
 * @remarks
 * Two-phase: every skill's `SKILL.md` is read and validated first, so a single malformed
 * file aborts the run before anything is written rather than leaving the tree half-synced.
 * Only plain subdirectories with safe names are targeted; symlinked entries are skipped so
 * they cannot redirect writes elsewhere, and every destination is re-checked to stay within
 * `agent/skills/`. Writes are skipped when the content is already up to date.
 *
 * @returns Counts of skills scanned, files written, and SKILL.md sections updated.
 */
const syncSharedReferences = async () => {
  const sources = await readSources();
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills = entries
    .filter((entry) => entry.isDirectory() && isSafeSegment(entry.name))
    .map((entry) => entry.name);

  // Phase 1 — resolve paths and validate every SKILL.md before touching the filesystem.
  const plans = [];
  for (const skill of skills) {
    const referencesDir = resolveWithin(
      skillsDir,
      join(skillsDir, skill, "references")
    );
    const skillFile = resolveWithin(
      skillsDir,
      join(skillsDir, skill, "SKILL.md")
    );
    const { currentMd, nextMd } = await planSkillSection(skillFile);
    plans.push({ currentMd, nextMd, referencesDir, skillFile });
  }

  // Phase 2 — apply, writing only what actually changed.
  let written = 0;
  let sections = 0;
  for (const { currentMd, nextMd, referencesDir, skillFile } of plans) {
    await mkdir(referencesDir, { recursive: true });
    for (const [name, contents] of sources) {
      const destination = resolveWithin(skillsDir, join(referencesDir, name));
      if (await writeIfChanged(destination, contents)) {
        written += 1;
      }
    }
    if (nextMd !== currentMd) {
      await writeFile(skillFile, nextMd);
      sections += 1;
    }
  }
  return { skills: skills.length, written, sections };
};

const { skills, written, sections } = await syncSharedReferences();
process.stdout.write(
  `shared skill references: wrote ${written} file(s), updated ${sections} SKILL.md section(s) across ${skills} skill(s)\n`
);
