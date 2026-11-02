/**
 * A PDF page's heading from its lines, top first — bnewPageInfo() in
 * public/shop2/app.js, the twin (tests/blog-files-simple.test.ts holds the
 * two alike): the first of the top six lines in capitals (three letters at
 * least, 120 characters at most), else the first line with a word in it.
 *
 * A module of its own so the two server readers that need it — the PDF read
 * from a link (src/lib/pdf-text.ts) and a PDF's text Claude passes with page
 * marks (pagesFromText in src/lib/blog-materials.ts) — share it without the
 * second pulling pdf-lib into every route that lists materials.
 */
export function pageHeading(lines: string[]): string {
  for (let i = 0; i < Math.min(lines.length, 6); i++) {
    const letters = lines[i].replace(/[^A-Za-zА-Яа-яЁё]/g, "");
    if (letters.length >= 3 && lines[i].length <= 120 && letters === letters.toUpperCase()) return lines[i].slice(0, 200);
  }
  for (const l of lines) if (/[A-Za-zА-Яа-яЁё]{3}/.test(l) && l.length <= 120) return l.slice(0, 200);
  return "";
}
