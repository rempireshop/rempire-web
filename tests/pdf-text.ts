/**
 * A very small PDF reader for the tests — the same extraction
 * tests/giftcard-pdf.test.ts carries inline, lifted out so the invoice's
 * test can read its page back the same way: inflate every stream, pair each
 * embedded font with its /ToUnicode CMap through the font dictionaries, then
 * decode the `<hex> Tj` runs of the content streams with the CMap of whatever
 * `Tf` selected. A genuine extraction — a page that drew the wrong number,
 * lost a line or dropped a Cyrillic glyph fails on it.
 *
 * Not a test file (vitest only collects tests/**\/*.test.ts).
 */
import { inflateSync } from "node:zlib";

/** Every top-level stream object, inflated where it is Flate-encoded. */
export function pdfStreams(bytes: Uint8Array): Map<number, string> {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  const out = new Map<number, string>();
  const objRe = /(\d+) 0 obj/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(raw))) {
    const num = Number(m[1]);
    const head = raw.indexOf("stream", m.index);
    const nextObj = raw.indexOf(" 0 obj", m.index + m[0].length);
    if (head < 0 || (nextObj > 0 && head > nextObj)) continue;
    const start = head + (raw.startsWith("stream\r\n", head) ? 8 : 7);
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const body = buf.subarray(start, end);
    try {
      out.set(num, inflateSync(body).toString("latin1"));
    } catch {
      out.set(num, body.toString("latin1"));
    }
  }
  return out;
}

/** `<0001> <0414>` pairs → code → character. */
function cmapOf(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]{4,})>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const chars = (m[2].match(/.{4}/g) ?? []).map((h) => String.fromCharCode(parseInt(h, 16)));
    map.set(m[1].toUpperCase(), chars.join(""));
  }
  return map;
}

/** All the text the pages draw, one string per `Tj`, in drawing order. */
export function pdfText(bytes: Uint8Array): string[] {
  const blobs = pdfStreams(bytes);
  const all = [...blobs.values()].join("\n");

  const family = new Map<string, Map<string, string>>();
  const fontRe = /\/BaseFont\s*\/([A-Za-z0-9+._-]+)[\s\S]{0,400}?\/ToUnicode\s+(\d+)\s+0\s+R/g;
  let f: RegExpExecArray | null;
  while ((f = fontRe.exec(all))) {
    const cmapText = blobs.get(Number(f[2]));
    if (!cmapText || !cmapText.includes("beginbfchar")) continue;
    family.set(f[1].replace(/-\d+$/, ""), cmapOf(cmapText));
  }

  const content = [...blobs.values()].filter((t) => t.includes("BT") && t.includes("Tj"));
  const runs: string[] = [];
  for (const stream of content) {
    let current: Map<string, string> | undefined;
    const opRe = /\/([A-Za-z0-9+._-]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj/g;
    let op: RegExpExecArray | null;
    while ((op = opRe.exec(stream))) {
      if (op[1]) {
        const name = op[1].replace(/-\d+$/, "");
        current = family.get(name) ?? [...family.entries()].find(([k]) => name.startsWith(k))?.[1];
        continue;
      }
      const codes = (op[2] ?? "").toUpperCase().match(/.{4}/g) ?? [];
      runs.push(codes.map((c) => current?.get(c) ?? "�").join(""));
    }
  }
  return runs;
}

/** Every `1 0 0 1 x y Tm` baseline in the content streams. */
export function pdfBaselines(bytes: Uint8Array): Array<{ x: number; y: number }> {
  const content = [...pdfStreams(bytes).values()].filter((t) => t.includes("BT") && t.includes("Tj"));
  const out: Array<{ x: number; y: number }> = [];
  for (const stream of content) {
    const re = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stream))) out.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return out;
}
