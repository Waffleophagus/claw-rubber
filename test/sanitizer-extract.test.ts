import { expect, test } from "bun:test";
import { extractContent } from "../src/services/sanitizer";

test("extractContent returns full text when maxChars is omitted", () => {
  const input = "<p>Hello</p><p>world</p>";
  const result = extractContent(input, "text");

  expect(result.content).toContain("Hello");
  expect(result.content).toContain("world");
  expect(result.truncated).toBe(false);
});

test("extractContent truncates only when maxChars is provided", () => {
  const input = "<p>abcdefghijklmnopqrstuvwxyz</p>";
  const result = extractContent(input, "text", 8);

  expect(result.content).toBe("abcdefgh");
  expect(result.truncated).toBe(true);
});

test("extractContent markdown mode strips scripts and keeps readable structure", () => {
  const input = "<h1>Title</h1><p>Alpha</p><script>alert('xss')</script><p>Beta</p>";
  const result = extractContent(input, "markdown");

  expect(result.content).toContain("# Title");
  expect(result.content).toContain("Alpha");
  expect(result.content).toContain("Beta");
  expect(result.content.includes("alert('xss')")).toBe(false);
});
