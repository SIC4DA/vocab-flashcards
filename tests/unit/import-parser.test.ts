import { describe, expect, it } from "vitest";
import { parseImport } from "@/lib/import-parser";

describe("parseImport", () => {
  it("parses tab, comma and ' - ' delimiters (auto)", () => {
    const r = parseImport("la casa\thouse\nel coche, car\nel perro - dog");
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { line: 1, term: "la casa", definition: "house" },
      { line: 2, term: "el coche", definition: "car" },
      { line: 3, term: "el perro", definition: "dog" },
    ]);
  });
  it("splits on the first delimiter only", () => {
    expect(parseImport("hola, adiós\thello, goodbye").rows[0]).toMatchObject({ term: "hola, adiós", definition: "hello, goodbye" });
    expect(parseImport("a, b, c", "comma").rows[0]).toMatchObject({ term: "a", definition: "b, c" });
  });
  it("skips blank lines", () => {
    const r = parseImport("\n\nuno - one\n   \n\ndos - two\n");
    expect(r.rows.map((x) => x.line)).toEqual([3, 6]);
    expect(r.errors).toEqual([]);
  });
  it("reports malformed lines with line numbers", () => {
    const r = parseImport("good - fine\nno delimiter here\n - missing term\nmissing def,  ");
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toEqual([
      { line: 2, text: "no delimiter here", reason: "No delimiter found" },
      { line: 3, text: " - missing term", reason: "Missing term" },
      { line: 4, text: "missing def,  ", reason: "Missing definition" },
    ]);
  });
  it("honours an explicit delimiter", () => {
    const r = parseImport("well-known - famous", "dash");
    expect(r.rows[0]).toMatchObject({ term: "well-known", definition: "famous" });
    expect(parseImport("a - b", "tab").errors).toHaveLength(1);
  });
  it("rejects overly long fields", () => {
    expect(parseImport(`${"x".repeat(201)} - y`).errors[0].reason).toBe("Too long");
  });
});
