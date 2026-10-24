import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanArea } from '../src/ui/scan.js';

test('scan: ZXing reads a band across the middle of the frame, at most 960 px wide', () => {
  assert.deepEqual(scanArea(1920, 1080), { sx: 0, sy: 216, sw: 1920, sh: 648, width: 960, height: 324 });
  assert.deepEqual(scanArea(640, 480), { sx: 0, sy: 96, sw: 640, sh: 288, width: 640, height: 288 });
  assert.deepEqual(scanArea(1080, 1920), { sx: 0, sy: 384, sw: 1080, sh: 1152, width: 960, height: 1024 });
});
