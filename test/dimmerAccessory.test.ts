import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findNearestLevel,
  remapToPhysicalPercent,
  resolveBrightnessCode,
  resolvePowerOnLevel,
} from '../src/accessories/dimmerAccessory';
import type { DimmerAccessoryConfig } from '../src/configTypes';

const baseConfig: DimmerAccessoryConfig = {
  name: 'Test Dimmer',
  zeroPercentCode: 'zero-code',
  levels: [
    { level: 25, code: 'twenty-five-code' },
    { level: 50, code: 'fifty-code', isMax: true },
    { level: 75, code: 'seventy-five-code', isDefault: true },
    { level: 100, code: 'hundred-code' },
  ],
};

test('remapToPhysicalPercent scales the slider onto the max level (todo worked example)', () => {
  assert.equal(remapToPhysicalPercent(100, baseConfig), 50);
  assert.equal(remapToPhysicalPercent(50, baseConfig), 25);
});

test('remapToPhysicalPercent is a no-op when no max level is configured', () => {
  const config: DimmerAccessoryConfig = { ...baseConfig, levels: baseConfig.levels.map((l) => ({ ...l, isMax: false })) };
  assert.equal(remapToPhysicalPercent(80, config), 80);
});

test('findNearestLevel matches the closest configured level, including the 0% candidate', () => {
  assert.equal(findNearestLevel(baseConfig, 2).code, 'zero-code');
  assert.equal(findNearestLevel(baseConfig, 30).code, 'twenty-five-code');
  assert.equal(findNearestLevel(baseConfig, 90).code, 'hundred-code');
});

test('resolveBrightnessCode remaps then nearest-matches', () => {
  // requested 100 -> physical 50 -> nearest is the 50% level itself
  assert.equal(resolveBrightnessCode(baseConfig, 100).code, 'fifty-code');
});

test('resolvePowerOnLevel prefers last-known brightness when enabled', () => {
  const config: DimmerAccessoryConfig = { ...baseConfig, useLastKnownBrightness: true };
  const lastKnown = { percent: 25, code: 'twenty-five-code' };
  assert.deepEqual(resolvePowerOnLevel(config, lastKnown), lastKnown);
});

test('resolvePowerOnLevel ignores last-known brightness when the checkbox is off', () => {
  const lastKnown = { percent: 25, code: 'twenty-five-code' };
  const resolved = resolvePowerOnLevel(baseConfig, lastKnown);
  assert.equal(resolved.code, 'seventy-five-code');
});

test('resolvePowerOnLevel falls back to the default level', () => {
  assert.deepEqual(resolvePowerOnLevel(baseConfig), { percent: 75, code: 'seventy-five-code' });
});

test('resolvePowerOnLevel falls back to the max level when no default is set', () => {
  const config: DimmerAccessoryConfig = {
    ...baseConfig,
    levels: baseConfig.levels.map((l) => ({ ...l, isDefault: false })),
  };
  assert.deepEqual(resolvePowerOnLevel(config), { percent: 50, code: 'fifty-code' });
});

test('resolvePowerOnLevel falls back to the highest level when no default or max is set', () => {
  const config: DimmerAccessoryConfig = {
    ...baseConfig,
    levels: baseConfig.levels.map((l) => ({ ...l, isDefault: false, isMax: false })),
  };
  assert.deepEqual(resolvePowerOnLevel(config), { percent: 100, code: 'hundred-code' });
});
