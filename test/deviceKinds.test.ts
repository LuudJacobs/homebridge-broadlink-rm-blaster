import { test } from 'node:test';
import assert from 'node:assert/strict';

import { uuid } from 'hap-nodejs';

import { accessoryUuidSeed, DEVICE_KINDS, generateUuid } from '../src/deviceKinds';

test('generateUuid matches hap-nodejs uuid.generate exactly', () => {
  // The manager finds cached accessories by UUID, so any drift from hap's
  // own derivation would silently reset/rename the wrong thing.
  for (const seed of ['homebridge-broadlink-rm-blaster:fan:Keuken Fan', 'a', '', 'ü — unicode']) {
    assert.equal(generateUuid(seed), uuid.generate(seed));
  }
});

test('every device kind builds the seed the platform uses', () => {
  assert.equal(accessoryUuidSeed('', 'Switch 1'), 'homebridge-broadlink-rm-blaster:Switch 1');
  assert.equal(accessoryUuidSeed('fan:', 'Fan 1'), 'homebridge-broadlink-rm-blaster:fan:Fan 1');
});

test('device kinds cover each configurable accessory array exactly once', () => {
  const keys = DEVICE_KINDS.map((kind) => kind.configKey);
  assert.deepEqual([...new Set(keys)], keys);
  assert.deepEqual(keys.sort(), ['accessories', 'advancedAccessories', 'dimmers', 'fans', 'tvs']);
});
