import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { consumeResets, queueResets, resetQueuePath } from '../src/stateReset';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'blaster-reset-'));
}

test('consumeResets returns nothing when none were ever queued', () => {
  assert.deepEqual(consumeResets(tempDir()), []);
});

test('queued resets survive to the next start, then clear themselves', () => {
  const dir = tempDir();
  queueResets(dir, ['UUID-A', 'UUID-B']);

  assert.deepEqual(consumeResets(dir).sort(), ['UUID-A', 'UUID-B']);
  // Applied once - a restart must not replay it.
  assert.deepEqual(consumeResets(dir), []);
  assert.equal(fs.existsSync(resetQueuePath(dir)), false);
});

test('a second manager session before a restart adds to the queue instead of replacing it', () => {
  const dir = tempDir();
  queueResets(dir, ['UUID-A']);
  queueResets(dir, ['UUID-B', 'UUID-A']);

  assert.deepEqual(consumeResets(dir).sort(), ['UUID-A', 'UUID-B']);
});

test('a corrupt queue file is ignored rather than crashing startup', () => {
  const dir = tempDir();
  fs.writeFileSync(resetQueuePath(dir), 'not json at all');

  assert.deepEqual(consumeResets(dir), []);
});
