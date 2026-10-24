// A small CSV reader for GTFS files: RFC 4180 quoting ("" escapes, commas and
// newlines inside quotes), a leading UTF-8 BOM, and LF, CRLF or lone CR line
// endings. Rows are handed to a callback one at a time so a 23 MB
// stop_times.txt never becomes an array of objects.

export interface CsvHeader {
  names: string[];
  /** Column index by name; -1 when the column is absent. */
  col(name: string): number;
}

function makeHeader(names: string[]): CsvHeader {
  const index = new Map<string, number>();
  names.forEach((n, i) => index.set(n.trim(), i));
  return { names, col: (name) => index.get(name) ?? -1 };
}

/**
 * Calls `onRow` for every data row of `text`, with the header, and returns
 * the header. Blank lines are skipped. Fields are returned exactly as written
 * (not trimmed).
 */
export function readCsv(text: string, onRow: (fields: string[], header: CsvHeader) => void): CsvHeader {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  let header: CsvHeader | null = null;

  const emit = (fields: string[]) => {
    if (fields.length === 1 && fields[0] === "") return; // blank line
    if (header === null) header = makeHeader(fields);
    else onRow(fields, header);
  };

  // Position of the next quote character at or after i; recomputed only when
  // passed, so a quote-free file is scanned once rather than once per line.
  let nextQuote = -2;
  while (i < n) {
    // Fast path: a line without quotes splits on commas.
    let end = text.indexOf("\n", i);
    if (end === -1) end = n;
    if (nextQuote !== -1 && nextQuote < i) nextQuote = text.indexOf('"', i);
    const quote = nextQuote;
    if (quote === -1 || quote >= end) {
      let lineEnd = end;
      if (lineEnd > i && text.charCodeAt(lineEnd - 1) === 13) lineEnd -= 1; // CRLF
      const line = text.slice(i, lineEnd);
      if (line.includes("\r")) {
        // Lone CR line endings inside this span: split them out.
        for (const part of line.split("\r")) emit(part.split(","));
      } else {
        emit(line.split(","));
      }
      i = end + 1;
      continue;
    }
    // Slow path: a quoted field somewhere on this row, possibly spanning lines.
    const fields: string[] = [];
    let field = "";
    let inQuotes = false;
    let atFieldStart = true;
    for (; i < n; i++) {
      const c = text.charCodeAt(i);
      if (inQuotes) {
        if (c === 34) {
          if (text.charCodeAt(i + 1) === 34) {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += text[i];
        }
        continue;
      }
      if (c === 34 && atFieldStart) {
        inQuotes = true;
        atFieldStart = false;
      } else if (c === 44) {
        fields.push(field);
        field = "";
        atFieldStart = true;
      } else if (c === 10 || c === 13) {
        if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
        i++;
        break;
      } else {
        field += text[i];
        atFieldStart = false;
      }
    }
    fields.push(field);
    emit(fields);
  }
  return header ?? makeHeader([]);
}
