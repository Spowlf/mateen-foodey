import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWeights, toUpload, summary } from '../../scripts/import-health-weights.js';

test('weight history import: reads the export a line at a time, keeps days already saved, and says what it will do', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'health-')), 'export.xml');
  const rec = (value, start) => ` <Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" startDate="${start}" endDate="${start}" value="${value}">\n  <MetadataEntry key="HKWasUserEntered" value="1"/>\n </Record>`;
  writeFileSync(file, ['<?xml version="1.0"?>', '<HealthData>', rec('80.2', '2019-01-03 07:00:00 +0000'), rec('79.9', '2019-01-04 07:00:00 +0000'), rec('79.5', '2019-01-05 07:00:00 +0000'), '</HealthData>'].join('\n'));
  const days = await readWeights(file);
  assert.equal(days.length, 3);
  const uploads = toUpload(days, new Set(['2019-01-04']));
  assert.deepEqual(uploads.map((d) => d.date), ['2019-01-03', '2019-01-05']);
  assert.equal(summary(days, uploads), [
    'Health: 3 days with a weight, 3 Jan 2019 to 5 Jan 2019.',
    '1 of them already has a reading, which is kept.',
    '2 to upload.',
    '  3 Jan 2019: 80.2 kg',
    '  5 Jan 2019: 79.5 kg',
  ].join('\n'));
  assert.match(summary([], []), /No body weights found/);
});
