import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { readXlsx } from '../../scripts/xlsx.js';
import { cofidFoods, cofidSql, summary, PROXIMATES, INORGANICS } from '../../scripts/import-cofid.js';
import { fakeD1 } from '../../scripts/sqlite-d1.js';

/** A zip of files ({ name: text }), the first stored and the rest deflated, as Excel writes them. */
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text], i) => {
    const raw = Buffer.from(text, 'utf8');
    const method = i === 0 ? 0 : 8;
    const data = method ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(method, 8); head.writeUInt32LE(crc32(raw), 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(head, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  });
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length / 2, 8); end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const col = (i) => String.fromCharCode(65 + i);

/** A workbook of sheets ({ name: [[cell]] }); text goes in shared strings, numbers inline, '' is skipped. */
function workbook(sheets) {
  const strings = [];
  const files = {
    'xl/workbook.xml': `<workbook><sheets>${Object.keys(sheets).map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${Object.keys(sheets).map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  };
  Object.values(sheets).forEach((rows, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rows.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => {
      if (v === '') return '';
      if (typeof v === 'number') return `<c r="${col(x)}${y + 1}"><v>${v}</v></c>`;
      strings.push(v);
      return `<c r="${col(x)}${y + 1}" t="s"><v>${strings.length - 1}</v></c>`;
    }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  });
  files['xl/sharedStrings.xml'] = `<sst>${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`;
  return zip(files);
}

// The real file's layout: names, then CoFID's codes, then long names, then foods. Inorganics' first header is blank.
const SHEETS = {
  [PROXIMATES]: [
    ['Food Code', 'Food Name', 'Protein (g)', 'Fat (g)', 'Carbohydrate (g)', 'Energy (kcal) (kcal)', 'Energy (kJ) (kJ)', 'Total sugars (g)', 'NSP (g)', 'AOAC fibre (g)'],
    ['', '', 'PROT', 'FAT', 'CHO', 'KCALS', 'KJ', 'TOTSUG', 'ENGFIB', 'AOACFIB'],
    ['', '', 'Protein', 'Fat', 'Carbohydrate', 'kcal', 'kJ', 'Total sugars', 'Non-starch polysaccharide', 'AOAC fibre'],
    ['11-001', 'Porridge oats, unfortified', 10.9, 8.1, 70.7, 381, 1611, 'Tr', 7.1, 7.8],
    ['13-001', 'Rice, white, boiled', 2.6, 0.3, 31.1, 138, 587, 'Tr', 0.1, ''],
    ['12-001', 'Allspice & cloves', 'N', 'N', 'N', 'N', 'N', 'N', '', ''],
    ['11-001', 'Porridge oats, again', 1, 1, 1, 1, 1, 1, 1, 1],
  ],
  [INORGANICS]: [
    [' ', 'Food Name', 'Sodium (mg)'], ['', '', 'NA'], ['', '', 'Sodium'],
    ['11-001', 'Porridge oats, unfortified', 'Tr'], ['13-001', 'Rice, white, boiled', 1],
  ],
};

test('xlsx: reads sheets, shared strings, numbers and gaps', () => {
  const wb = readXlsx(workbook({ One: [['a & b', '', 3]], Two: [[1]] }));
  assert.deepEqual(wb.sheets, ['One', 'Two']);
  assert.deepEqual(wb.rows('One'), [['a & b', '', '3']]);
  assert.throws(() => wb.rows('Three'), /no sheet/);
});

test('import: CoFID rows become per-100 g foods, joined to their sodium by code', () => {
  const { foods, skipped, fibreUnknown } = cofidFoods(readXlsx(workbook(SHEETS)));
  assert.deepEqual(foods.map((f) => [f.sourceId, f.name, f.state]), [['11-001', 'Porridge oats, unfortified', 'asSold'], ['13-001', 'Rice, white, boiled', 'cooked']]);
  assert.deepEqual(foods[0].per100g, { kcalTenths: 3810, proteinMg: 10900, carbsMg: 70700, fatMg: 8100, fibreMg: 7800, sugarsMg: 0, saltMg: 0 });
  assert.equal(foods[1].per100g.fibreMg, null);   // only NSP given: AOAC fibre unknown, never 0
  assert.equal(foods[1].per100g.saltMg, 3);        // 1 mg sodium × 2.5, rounded
  assert.deepEqual(skipped, ['Allspice & cloves']);
  assert.equal(fibreUnknown, 1);
  assert.match(summary({ foods, skipped, fibreUnknown }), /^CoFID: 2 foods to import\.\n1 left out with no energy: Allspice & cloves\nFibre unknown for 1/);
});

test('import: the SQL writes the cache, and running it again updates rather than adds', async () => {
  const { foods } = cofidFoods(readXlsx(workbook(SHEETS)));
  const db = fakeD1();
  const text = cofidSql([{ ...foods[0], name: "Baker's oats" }, foods[1]], 5);
  await db.exec(text);
  await db.exec(cofidSql(foods, 6));
  const rows = db.raw.prepare('SELECT id, name, nameNorm, fetchedAt FROM sourceFoods ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { id: 'cofid:11-001', name: 'Porridge oats, unfortified', nameNorm: 'porridge oats unfortified', fetchedAt: 6 },
    { id: 'cofid:13-001', name: 'Rice, white, boiled', nameNorm: 'rice white boiled', fetchedAt: 6 },
  ]);
});
