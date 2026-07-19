import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseHexCode } from '../src/broadlinkClient';
import { selectPowerCode } from '../src/accessories/basicAccessory';

test('parseHexCode converts a hex string to a Buffer', () => {
  const result = parseHexCode('26005c00');
  assert.deepEqual(result, Buffer.from([0x26, 0x00, 0x5c, 0x00]));
});

test('parseHexCode strips whitespace before parsing', () => {
  const result = parseHexCode('26 00 5c 00\n');
  assert.deepEqual(result, Buffer.from([0x26, 0x00, 0x5c, 0x00]));
});

test('selectPowerCode returns the power-on code when turning on', () => {
  const code = selectPowerCode({ powerOnCode: 'on-code', powerOffCode: 'off-code' }, true);
  assert.equal(code, 'on-code');
});

test('selectPowerCode returns the power-off code when turning off', () => {
  const code = selectPowerCode({ powerOnCode: 'on-code', powerOffCode: 'off-code' }, false);
  assert.equal(code, 'off-code');
});

test('selectPowerCode falls back to the power-on code when no power-off code is configured', () => {
  const code = selectPowerCode({ powerOnCode: 'on-code' }, false);
  assert.equal(code, 'on-code');
});
