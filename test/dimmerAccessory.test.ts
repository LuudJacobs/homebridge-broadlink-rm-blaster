import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findNearestLevel,
  remapToPhysicalPercent,
  resolveBrightnessCode,
  resolvePowerOnLevel,
  resolveStepTarget,
} from '../src/accessories/dimmerAccessory';
import type { DimmerAccessoryConfig } from '../src/configTypes';

const baseConfig: DimmerAccessoryConfig = {
  name: 'Test Dimmer',
  zeroPercentCode: 'zero-code',
  hundredPercentCode: 'hundred-code',
  levels: [
    { level: 25, code: 'twenty-five-code' },
    { level: 50, code: 'fifty-code' },
    { level: 75, code: 'seventy-five-code' },
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

test('the dedicated 100% signal is reachable even with no configured level near it', () => {
  const config: DimmerAccessoryConfig = {
    name: 'Sparse Dimmer',
    zeroPercentCode: 'zero-code',
    hundredPercentCode: 'true-hundred-code',
    levels: [
      { level: 25, code: 'twenty-five-code' },
      { level: 50, code: 'fifty-code' },
    ],
  };
  assert.equal(resolveBrightnessCode(config, 95).code, 'true-hundred-code');
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

test('resolvePowerOnLevel remaps the default percentage through the configured max (todo worked example)', () => {
  // default=100 (logical) with max=50 -> physical 50 -> nearest is the 50% level itself.
  // Without the remap this would incorrectly resolve to 'hundred-code'.
  const config: DimmerAccessoryConfig = { ...withMax50, useDefaultBrightnessLevel: true, defaultBrightnessLevel: 100 };
  assert.deepEqual(resolvePowerOnLevel(config), { percent: 100, code: 'fifty-code' });
});

test('resolvePowerOnLevel nearest-matches the remapped default when it lands between configured levels', () => {
  // default=50 (logical) with max=50 -> physical 25 -> nearest is the 25% level
  const config: DimmerAccessoryConfig = { ...withMax50, useDefaultBrightnessLevel: true, defaultBrightnessLevel: 50 };
  assert.deepEqual(resolvePowerOnLevel(config), { percent: 50, code: 'twenty-five-code' });
});

test('resolvePowerOnLevel falls back to the configured max level when no default is set', () => {
  assert.deepEqual(resolvePowerOnLevel(withMax50), { percent: 50, code: 'fifty-code' });
});

test('resolvePowerOnLevel falls back to the highest level when no default or max is set', () => {
  assert.deepEqual(resolvePowerOnLevel(baseConfig), { percent: 100, code: 'hundred-code' });
});

test('resolveStepTarget: up while off (0%) lands on the lowest configured level', () => {
  assert.deepEqual(resolveStepTarget(baseConfig, 0, 'up'), { percent: 25, code: 'twenty-five-code' });
});

test('resolveStepTarget: down while off (0%) has nowhere to go', () => {
  assert.equal(resolveStepTarget(baseConfig, 0, 'down'), undefined);
});

test('resolveStepTarget: down from the lowest configured level goes to 0% (off)', () => {
  assert.deepEqual(resolveStepTarget(baseConfig, 25, 'down'), { percent: 0, code: 'zero-code' });
});

test('resolveStepTarget: steps to the adjacent configured level in the middle of the list', () => {
  assert.deepEqual(resolveStepTarget(baseConfig, 50, 'up'), { percent: 75, code: 'seventy-five-code' });
  assert.deepEqual(resolveStepTarget(baseConfig, 50, 'down'), { percent: 25, code: 'twenty-five-code' });
});

test('resolveStepTarget: up respects the configured max, refusing to step past it', () => {
  // withMax50 candidates are capped to [0, 25, 50] - already at the capped ceiling
  assert.equal(resolveStepTarget(withMax50, 50, 'up'), undefined);
});
