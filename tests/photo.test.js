import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSize } from '../src/ui/photo.js';

test('photo: resized to 1,024 px on the long edge, never enlarged', () => {
  assert.deepEqual(fitSize(4032, 3024), { width: 1024, height: 768 });
  assert.deepEqual(fitSize(3024, 4032), { width: 768, height: 1024 });
  assert.deepEqual(fitSize(800, 600), { width: 800, height: 600 });
});
