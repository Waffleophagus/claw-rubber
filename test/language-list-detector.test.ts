import { expect, test } from "bun:test";
import { detectLanguageList } from "../src/services/language-list-detector";

test("detects wikipedia-style language selector content", () => {
  const sample = "English العربية Asturianu Azərbaycanca বাংলা Català Dansk Deutsch Español فارسی Français Հայերեն Русский";
  const result = detectLanguageList(sample);

  expect(result.isLanguageListLikely).toBe(true);
  expect(result.distinctMatchCount).toBeGreaterThanOrEqual(6);
});

test("does not classify regular prose as language list", () => {
  const sample = "Victorian architecture emerged in the nineteenth century and spread across civic and residential buildings.";
  const result = detectLanguageList(sample);

  expect(result.isLanguageListLikely).toBe(false);
});

test("supports env-provided language name extensions", () => {
  const sample = "English Klingon tlhIngan Hol العربية";
  const result = detectLanguageList(sample, ["klingon", "tlhingan hol"]);

  expect(result.isLanguageListLikely).toBe(true);
  expect(result.matchedNames.includes("tlhingan hol")).toBe(true);
});
