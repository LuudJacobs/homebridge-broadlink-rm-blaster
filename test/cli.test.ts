import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isValidHexCode } from '../src/cli';

test('isValidHexCode accepts a well-formed hex string', () => {
  assert.equal(isValidHexCode('26005c00'), true);
});

test('isValidHexCode accepts whitespace-separated hex', () => {
  assert.equal(isValidHexCode('26 00 5c 00\n'), true);
});

test('isValidHexCode rejects an odd number of hex digits', () => {
  assert.equal(isValidHexCode('26005c0'), false);
});

test('isValidHexCode rejects non-hex characters', () => {
  assert.equal(isValidHexCode('26zz5c00'), false);
});

test('isValidHexCode rejects an empty string', () => {
  assert.equal(isValidHexCode('   '), false);
});
