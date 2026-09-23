// Jarvis · © 2026 Upendra Sengar · MIT License · https://github.com/Upendrasengar/jarvis
// A note whose frontmatter is preceded by prose reached the owner's screen
// verbatim — header dumped as body text. Fixed at the generator AND at every
// reader; these lock in the reader half.
import { describe, expect, it } from "vitest";
import { frontmatterStart, parseFrontmatter } from "@jarvis/shared";

const NOTE = '---\ntitle: A Call\ntype: call\ntags:\n  - call\n---\n\n# A Call\n\nBody line.\n';

describe("parseFrontmatter", () => {
  it("reads a well-formed note", () => {
    const { start, block, body } = parseFrontmatter(NOTE);
    expect(start).toBe(0);
    expect(block).toContain("title: A Call");
    expect(body.trimStart()).toMatch(/^# A Call/);
  });

  // The JEDI call, 2026-09-22: the model opened with a consent aside and the
  // whole YAML header rendered as prose under it.
  it("finds the block behind a preamble, and keeps the preamble as body", () => {
    const pre = "One flag before the note: they discussed *not* recording.\n\n";
    const { start, block, body } = parseFrontmatter(pre + NOTE);
    expect(start).toBe(pre.length);
    expect(block).toContain("title: A Call");
    expect(body).toContain("One flag before the note");
    expect(body).not.toContain("title: A Call");
  });

  it("tolerates leading blank lines", () => {
    expect(parseFrontmatter("\n\n" + NOTE).block).toContain("title: A Call");
  });

  it("recovers an unterminated block", () => {
    const { block, body } = parseFrontmatter("---\ntitle: A Call\ntype: call\n\n# A Call\n");
    expect(block).toContain("title: A Call");
    expect(body.trimStart()).toMatch(/^# A Call/);
  });

  // The guard that keeps the tolerance from eating real content: a horizontal
  // rule is a --- too, and a note may well have one.
  it("does not mistake a horizontal rule for frontmatter", () => {
    const md = "Just prose.\n\n---\n\nMore prose: with a colon.\n";
    expect(frontmatterStart(md)).toBe(-1);
    expect(parseFrontmatter(md).body).toBe(md);
  });

  it("reports no frontmatter when there is none", () => {
    expect(parseFrontmatter("# Bare note\n").start).toBe(-1);
  });
});
