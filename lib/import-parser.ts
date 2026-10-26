/** Bulk import parser: one `term<TAB | comma | " - ">definition` per line (pure). */
import { CARD_LIMITS } from "./validation";

export type Delimiter = "auto" | "tab" | "comma" | "dash";

export type ParsedRow = { line: number; term: string; definition: string };
export type ParseError = { line: number; text: string; reason: string };
export type ParseResult = { rows: ParsedRow[]; errors: ParseError[] };

const SEPARATORS: Record<Exclude<Delimiter, "auto">, string> = {
  tab: "\t",
  dash: " - ",
  comma: ",",
};

function splitLine(line: string, delimiter: Delimiter): [string, string] | null {
  const order: Exclude<Delimiter, "auto">[] = delimiter === "auto" ? ["tab", "dash", "comma"] : [delimiter];
  for (const d of order) {
    const sep = SEPARATORS[d];
    const idx = line.indexOf(sep);
    if (idx >= 0) return [line.slice(0, idx), line.slice(idx + sep.length)];
  }
  return null;
}

export function parseImport(text: string, delimiter: Delimiter = "auto"): ParseResult {
  const rows: ParsedRow[] = [];
  const errors: ParseError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const parts = splitLine(raw, delimiter);
    if (!parts) {
      errors.push({ line, text: raw, reason: "No delimiter found" });
      return;
    }
    const term = parts[0].trim();
    const definition = parts[1].trim();
    if (!term || !definition) {
      errors.push({ line, text: raw, reason: !term ? "Missing term" : "Missing definition" });
      return;
    }
    if (term.length > CARD_LIMITS.term || definition.length > CARD_LIMITS.definition) {
      errors.push({ line, text: raw, reason: "Too long" });
      return;
    }
    rows.push({ line, term, definition });
  });
  return { rows, errors };
}
