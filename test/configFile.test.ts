import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findPlatformBlock, stripBlankEntries } from '../src/configFile';
import type { BlasterPlatformConfig } from '../src/configTypes';

test('findPlatformBlock finds the BroadlinkRMBlaster platform among others', () => {
  const config = {
    platforms: [
      { platform: 'SomeOtherPlugin', foo: 'bar' },
      { platform: 'BroadlinkRMBlaster', rmDevices: [{ name: 'Default RM', ip: '192.168.1.50' }] },
    ],
  };
  const platform = findPlatformBlock(config);
  assert.equal(platform?.platform, 'BroadlinkRMBlaster');
  assert.deepEqual(platform?.rmDevices, [{ name: 'Default RM', ip: '192.168.1.50' }]);
});

test('findPlatformBlock returns undefined when no platforms array exists', () => {
  assert.equal(findPlatformBlock({}), undefined);
});

test('findPlatformBlock returns undefined when the platform is not configured', () => {
  const config = { platforms: [{ platform: 'SomeOtherPlugin' }] };
  assert.equal(findPlatformBlock(config), undefined);
});

function baseConfig(): BlasterPlatformConfig {
  return {
    platform: 'BroadlinkRMBlaster',
    rmDevices: [{ name: 'Living Room RM', ip: '192.168.1.50' }],
  };
}

test('stripBlankEntries drops a nameless entry from each top-level array', () => {
  const config: BlasterPlatformConfig = {
    ...baseConfig(),
    accessories: [{ name: 'Lamp', rmDevice: 'RM', accessoryType: 'switch', powerOnCode: 'AB' }, { name: '' } as never],
    advancedAccessories: [{ name: '' } as never],
    dimmers: [{ name: '' } as never],
    tvs: [{ name: '' } as never],
    rmDevices: [{ name: 'Living Room RM', ip: '192.168.1.50' }, { name: '  ' } as never],
  };

  const { config: cleaned, removed } = stripBlankEntries(config);

  assert.deepEqual(cleaned.accessories?.map((a) => a.name), ['Lamp']);
  assert.equal(cleaned.advancedAccessories?.length, 0);
  assert.equal(cleaned.dimmers?.length, 0);
  assert.equal(cleaned.tvs?.length, 0);
  assert.deepEqual(cleaned.rmDevices.map((r) => r.name), ['Living Room RM']);
  assert.equal(removed.length, 5);
});

test('stripBlankEntries drops a nameless mode but leaves the fan itself', () => {
  const config: BlasterPlatformConfig = {
    ...baseConfig(),
    fans: [{
      name: 'Bedroom Heater',
      rmDevice: 'RM',
      modes: [
        { powersOn: false, powersOff: false, remembers: false } as never,
        { powersOn: false, powersOff: false, remembers: false } as never,
      ],
    }],
  };

  const { config: cleaned, removed } = stripBlankEntries(config);

  assert.equal(cleaned.fans?.[0].name, 'Bedroom Heater');
  assert.equal(cleaned.fans?.[0].modes?.length, 0);
  assert.deepEqual(removed, ['2 blank mode rows on "Bedroom Heater"']);
});

test('stripBlankEntries leaves a named mode alone even if it is missing an onCode', () => {
  const config: BlasterPlatformConfig = {
    ...baseConfig(),
    fans: [{ name: 'Fan', rmDevice: 'RM', modes: [{ name: 'Cool' } as never] }],
  };

  const { config: cleaned, removed } = stripBlankEntries(config);

  assert.deepEqual(cleaned.fans?.[0].modes, [{ name: 'Cool' }]);
  assert.deepEqual(removed, []);
});

test('stripBlankEntries is a no-op on an already-clean config', () => {
  const config: BlasterPlatformConfig = {
    ...baseConfig(),
    accessories: [{ name: 'Lamp', rmDevice: 'RM', accessoryType: 'switch', powerOnCode: 'AB' }],
    fans: [{ name: 'Fan', rmDevice: 'RM', modes: [{ name: 'Cool', onCode: 'AB' }] }],
  };

  const { removed } = stripBlankEntries(config);

  assert.deepEqual(removed, []);
});
