import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeCyclePresses,
  computeStepPresses,
  levelForPercent,
  percentForLevel,
  speedsAreAllOn,
} from '../src/accessories/fanAccessory';

test('a fan whose lowest speed switches it off has an off level at the bottom', () => {
  // off -> 1 -> 2 -> 3 -> off, so level 0 really is off.
  assert.equal(speedsAreAllOn({ name: 'F', rmDevice: 'RM', speedPowersOff: true }), false);
  assert.equal(percentForLevel(0, 3, false), 0);
  assert.equal(percentForLevel(2, 3, false), 100);
});

test('a fan with a separate off button has no off level among its speeds', () => {
  // 1 -> 2 -> 3 -> 1, with off sitting outside the cycle entirely.
  assert.equal(speedsAreAllOn({ name: 'F', rmDevice: 'RM', speedPowersOn: true }), true);
  assert.equal(percentForLevel(0, 3, true), 33);
  assert.equal(percentForLevel(1, 3, true), 67);
  assert.equal(percentForLevel(2, 3, true), 100);
});

test('a heater whose speed button neither powers on nor off still runs at every speed', () => {
  // The heat button doesn't touch power, but H1 is still heating.
  assert.equal(speedsAreAllOn({ name: 'H', rmDevice: 'RM' }), true);
  assert.equal(percentForLevel(0, 2, true), 50);
  assert.equal(percentForLevel(1, 2, true), 100);
});

test('levelForPercent nearest-matches and clamps', () => {
  assert.equal(levelForPercent(0, 3, false), 0);
  assert.equal(levelForPercent(40, 3, false), 1);
  assert.equal(levelForPercent(140, 3, false), 2);
  assert.equal(levelForPercent(-20, 3, false), 0);
});

test('percent and level round-trip every speed, with and without an off level', () => {
  for (const allOn of [false, true]) {
    for (const levelCount of [2, 3, 4, 5]) {
      for (let level = 0; level < levelCount; level++) {
        assert.equal(levelForPercent(percentForLevel(level, levelCount, allOn), levelCount, allOn), level);
      }
    }
  }
});

test('computeCyclePresses only ever moves forward, wrapping at the top', () => {
  assert.equal(computeCyclePresses(0, 2, 3), 2);
  assert.equal(computeCyclePresses(2, 0, 3), 1);
  assert.equal(computeCyclePresses(1, 1, 3), 0);
});

test('computeStepPresses steps directly in either direction without wrapping', () => {
  assert.deepEqual(computeStepPresses(0, 2), { direction: 'up', presses: 2 });
  assert.deepEqual(computeStepPresses(2, 0), { direction: 'down', presses: 2 });
  assert.deepEqual(computeStepPresses(1, 1), { direction: 'up', presses: 0 });
});
