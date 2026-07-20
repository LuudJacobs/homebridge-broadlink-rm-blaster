import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRemoteKeyCode } from '../src/accessories/tvAccessory';
import type { TvAccessoryConfig } from '../src/configTypes';

const baseConfig: TvAccessoryConfig = {
  name: 'Test TV',
  rmDevice: 'Default RM',
  powerOnCode: 'power-on-code',
  arrowUpCode: 'arrow-up-code',
  selectCode: 'select-code',
};

test('resolveRemoteKeyCode maps arrow keys to their configured signals', () => {
  assert.deepEqual(resolveRemoteKeyCode(baseConfig, 4), { signalName: 'Arrow Up', code: 'arrow-up-code' });
  assert.deepEqual(resolveRemoteKeyCode(baseConfig, 8), { signalName: 'Select', code: 'select-code' });
});

test('resolveRemoteKeyCode returns the signal name with an undefined code when unconfigured', () => {
  assert.deepEqual(resolveRemoteKeyCode(baseConfig, 5), { signalName: 'Arrow Down', code: undefined });
  assert.deepEqual(resolveRemoteKeyCode(baseConfig, 9), { signalName: 'Back', code: undefined });
  assert.deepEqual(resolveRemoteKeyCode(baseConfig, 10), { signalName: 'Exit', code: undefined });
  assert.deepEqual(resolveRemoteKeyCode(baseConfig, 15), { signalName: 'Info', code: undefined });
});

test('resolveRemoteKeyCode returns undefined for RemoteKey values outside the todo spec (e.g. rewind, play/pause)', () => {
  assert.equal(resolveRemoteKeyCode(baseConfig, 0), undefined);
  assert.equal(resolveRemoteKeyCode(baseConfig, 11), undefined);
});
