---
description: Use when drafting or editing release notes or a changelog entry in the house voice.
---

# Release notes voice & style

When writing or editing release notes:

- Lead with what changed for the user, in their words — not the internal feature name.
- Group by what the reader does, not by team or component.
- Each entry: what changed, why it matters, and (if relevant) what to do about it.
- Plain present tense: "You can now…", "Fixed an issue where…".
- Link to docs or a deeper post instead of explaining everything inline.
- Be honest about breaking changes — call them out first, with the migration path.
- No marketing adjectives. A changelog is a record, not a pitch.

## Structure

Group entries under clear headings in this order:

1. **Breaking changes** — what to do, up front.
2. **New** — capabilities the reader didn't have before.
3. **Improved** — things that already worked, now better.
4. **Fixed** — bugs resolved, described from the symptom the user saw.

## References

- `references/banned-words.json` — the list of words to avoid. Read it once up front for
  awareness, then run the `lint_against_style` tool on your draft to check it against this
  file before proposing the draft to the writer.
