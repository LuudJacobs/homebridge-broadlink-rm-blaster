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
    { level: 50, code: 'fifty-code' },
    { level: 75, code: 'seventy-five-code' },
    { level: 100, code: 'hundred-code' },
  ],
};

const withMax50: DimmerAccessoryConfig = { ...baseConfig, useMaxBrightnessLevel: true, maxBrightnessLevel: 50 };

test('remapToPhysicalPercent scales the slider onto the configured max level (todo worked example)', () => {
  assert.equal(remapToPhysicalPercent(100, withMax50), 50);
  assert.equal(remapToPhysicalPercent(50, withMax50), 25);
});

test('remapToPhysicalPercent is a no-op when no max level is configured', () => {
  assert.equal(remapToPhysicalPercent(80, baseConfig), 80);
});

test('findNearestLevel matches the closest configured level, including the 0% candidate', () => {
  assert.equal(findNearestLevel(baseConfig, 2).code, 'zero-code');
  assert.equal(findNearestLevel(baseConfig, 30).code, 'twenty-five-code');
  assert.equal(findNearestLevel(baseConfig, 90).code, 'hundred-code');
});

test('resolveBrightnessCode remaps then nearest-matches', () => {
  // requested 100 -> physical 50 -> nearest is the 50% level itself
  assert.equal(resolveBrightnessCode(withMax50, 100).code, 'fifty-code');
});

test('resolvePowerOnLevel prefers last-known brightness when enabled', () => {
  const config: DimmerAccessoryConfig = { ...baseConfig, useLastKnownBrightness: true };
  const lastKnown = { percent: 25, code: 'twenty-five-code' };
  assert.deepEqual(resolvePowerOnLevel(config, lastKnown), lastKnown);
});

test('resolvePowerOnLevel ignores last-known brightness when the checkbox is off', () => {
  const config: DimmerAccessoryConfig = { ...baseConfig, useDefaultBrightnessLevel: true, defaultBrightnessLevel: 75 };
  const lastKnown = { percent: 25, code: 'twenty-five-code' };
  const resolved = resolvePowerOnLevel(config, lastKnown);
  assert.equal(resolved.code, 'seventy-five-code');
});

test('resolvePowerOnLevel falls back to the configured default level', () => {
  const config: DimmerAccessoryConfig = { ...baseConfig, useDefaultBrightnessLevel: true, defaultBrightnessLevel: 75 };
  assert.deepEqual(resolvePowerOnLevel(config), { percent: 75, code: 'seventy-five-code' });
});

test('resolvePowerOnLevel keeps the configured target percent even when it needs nearest-matching', () => {
  // 80 isn't a configured level; nearest is 75, but the displayed percent should stay the admin's target (80)
  const config: DimmerAccessoryConfig = { ...baseConfig, useDefaultBrightnessLevel: true, defaultBrightnessLevel: 80 };
  assert.deepEqual(resolvePowerOnLevel(config), { percent: 80, code: 'seventy-five-code' });
});

test('resolvePowerOnLevel falls back to the configured max level when no default is set', () => {
  assert.deepEqual(resolvePowerOnLevel(withMax50), { percent: 50, code: 'fifty-code' });
});

test('resolvePowerOnLevel falls back to the highest level when no default or max is set', () => {
  assert.deepEqual(resolvePowerOnLevel(baseConfig), { percent: 100, code: 'hundred-code' });
});
