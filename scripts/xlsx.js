// Just enough of an .xlsx reader for the CoFID spreadsheet, with no dependencies: the zip's central
// directory, Node's own inflate, shared strings and one sheet's cells as text.

import { inflateRawSync } from 'node:zlib';

/** The files in a zip, by name: { name: Buffer }. Only stored and deflated entries are read. */
export function unzip(buf, wanted = () => true) {
  // The end of central directory record is in the last 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('damaged zip file');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) out[name] = data;
    else if (method === 8) out[name] = inflateRawSync(data);
    else throw new Error(`unsupported zip method ${method}`);
  }
  return out;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e] ?? m;
});

/** The text of every <t> in a fragment (rich text has several). */
const textOf = (xml) => unescape([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

/** "AB12" → 27 (0-based column). */
function column(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Sheet names in workbook order, each with its file: [{ name, file }]. */
function sheetFiles(files) {
  const rels = new Map([...files['xl/_rels/workbook.xml.rels'].toString('utf8').matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /\bId="([^"]+)"/.exec(m[0])[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])[1].replace(/^\/?(xl\/)?/, '');
    return [id, `xl/${target}`];
  }));
  return [...files['xl/workbook.xml'].toString('utf8').matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: unescape(/\bname="([^"]*)"/.exec(m[0])[1]),
    file: rels.get(/\br:id="([^"]+)"/.exec(m[0])[1]),
  }));
}

/**
 * Reads a workbook. Returns { sheets: [name], rows(name) }, where rows(name) gives that sheet's rows
 * as arrays of cell text ('' for empty cells).
 */
export function readXlsx(buf) {
  const files = unzip(buf, (n) => n.startsWith('xl/') && n.endsWith('.xml') || n.endsWith('.rels'));
  const shared = files['xl/sharedStrings.xml']
    ? [...files['xl/sharedStrings.xml'].toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
    : [];
  const sheets = sheetFiles(files);
  return {
    sheets: sheets.map((s) => s.name),
    rows(name) {
      const sheet = sheets.find((s) => s.name === name);
      if (!sheet || !files[sheet.file]) throw new Error(`no sheet called ${name}`);
      const out = [];
      for (const [, body] of files[sheet.file].toString('utf8').matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const row = [];
        for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = m[1];
          const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
          const type = /\bt="(\w+)"/.exec(attrs)?.[1];
          const inner = m[2] ?? '';
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          let value = '';
          if (type === 's') value = shared[Number(v)] ?? '';
          else if (type === 'inlineStr') value = textOf(inner);
          else if (v != null) value = unescape(v);
          const at = ref ? column(ref) : row.length;
          while (row.length < at) row.push('');
          row[at] = value;
        }
        out.push(row);
      }
      return out;
    },
  };
}
