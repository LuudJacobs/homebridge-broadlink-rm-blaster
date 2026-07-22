import { test } from 'node:test';
import assert from 'node:assert/strict';

import { placeholderMacForIp } from '../src/broadlinkClient';

test('placeholderMacForIp produces a distinct 6-byte buffer per IP', () => {
  const a = placeholderMacForIp('10.0.7.21');
  const b = placeholderMacForIp('10.0.7.22');

  assert.equal(a.length, 6);
  assert.equal(b.length, 6);
  assert.notDeepEqual(a, b);
});

test('placeholderMacForIp is deterministic for the same IP', () => {
  assert.deepEqual(placeholderMacForIp('192.168.1.50'), placeholderMacForIp('192.168.1.50'));
});
