import { describe, expect, it } from "vitest";
import {
  isReservedPath,
  isReservedUrl,
  RESERVED_PATH_ERROR,
} from "#lib/reserved-paths.js";

const STORE = "https://store123.private.blob.vercel-storage.com";

describe("isReservedPath", () => {
  it("flags the memory prefixes", () => {
    expect(isReservedPath("eve/memory/file/alice.md")).toBe(true);
    expect(isReservedPath("eve/memory/")).toBe(true);
    expect(isReservedPath("writer-preferences/alice.json")).toBe(true);
  });

  it("allows ordinary asset paths, including look-alikes", () => {
    expect(isReservedPath("drafts/launch-post.md")).toBe(false);
    expect(isReservedPath("eve/memory")).toBe(false);
    expect(isReservedPath("eve/memory-export/a.md")).toBe(false);
    expect(isReservedPath("drafts/eve/memory/a.md")).toBe(false);
    expect(isReservedPath("writer-preferences.md")).toBe(false);
    expect(isReservedPath("")).toBe(false);
  });
});

describe("isReservedUrl", () => {
  it("flags URLs that address a reserved object", () => {
    expect(isReservedUrl(`${STORE}/eve/memory/file/alice.md`)).toBe(true);
    expect(isReservedUrl(`${STORE}/writer-preferences/alice.json`)).toBe(true);
  });

  it("ignores extra leading slashes and resolves dot segments", () => {
    expect(isReservedUrl(`${STORE}//eve/memory/file/alice.md`)).toBe(true);
    expect(isReservedUrl(`${STORE}/drafts/../eve/memory/a.md`)).toBe(true);
  });

  it("ignores the query string and fragment", () => {
    expect(isReservedUrl(`${STORE}/eve/memory/a.md?download=1#top`)).toBe(true);
    expect(isReservedUrl(`${STORE}/drafts/a.md?next=eve/memory/`)).toBe(false);
  });

  it("allows ordinary asset URLs", () => {
    expect(isReservedUrl(`${STORE}/drafts/launch-post.md`)).toBe(false);
    expect(isReservedUrl(`${STORE}/`)).toBe(false);
  });

  it("treats unparseable input as not reserved", () => {
    expect(isReservedUrl("not a url")).toBe(false);
    expect(isReservedUrl("")).toBe(false);
    expect(isReservedUrl("eve/memory/file/alice.md")).toBe(false);
  });
});

describe("RESERVED_PATH_ERROR", () => {
  it("names the reason without naming a path", () => {
    expect(RESERVED_PATH_ERROR).toContain("reserved");
    expect(RESERVED_PATH_ERROR).not.toContain("eve/memory");
  });
});
