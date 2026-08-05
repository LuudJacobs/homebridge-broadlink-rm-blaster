import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findPlatformBlock } from '../src/configFile';

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
