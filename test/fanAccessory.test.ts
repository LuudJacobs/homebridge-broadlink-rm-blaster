import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  modeLevelsAreAllOn,
  computeActivationPresses,
  computeCyclePresses,
  computeReturnLevel,
  computeStepPresses,
  levelForPercent,
  percentForLevel,
} from '../src/accessories/fanAccessory';

test('percentForLevel spreads 0-indexed levels across the full slider', () => {
  // 3 speeds: levels 0/1/2 -> 0%/50%/100%.
  assert.equal(percentForLevel(0, 3), 0);
  assert.equal(percentForLevel(1, 3), 50);
  assert.equal(percentForLevel(2, 3), 100);
});

test('percentForLevel treats a single-level mode as plain on/off', () => {
  assert.equal(percentForLevel(0, 1), 0);
  assert.equal(percentForLevel(1, 1), 100);
});

test('levelForPercent nearest-matches back onto a level', () => {
  assert.equal(levelForPercent(0, 3), 0);
  assert.equal(levelForPercent(40, 3), 1);
  assert.equal(levelForPercent(60, 3), 1);
  assert.equal(levelForPercent(100, 3), 2);
});

test('levelForPercent clamps into range', () => {
  assert.equal(levelForPercent(-20, 3), 0);
  assert.equal(levelForPercent(140, 3), 2);
});

test('percentForLevel and levelForPercent round-trip every level', () => {
  for (const levelCount of [2, 3, 4, 5]) {
    for (let level = 0; level < levelCount; level++) {
      assert.equal(levelForPercent(percentForLevel(level, levelCount), levelCount), level);
    }
  }
});

test('computeCyclePresses only ever moves forward, wrapping at the top', () => {
  assert.equal(computeCyclePresses(0, 2, 3), 2);
  assert.equal(computeCyclePresses(2, 0, 3), 1);
  assert.equal(computeCyclePresses(2, 1, 3), 2);
});

test('computeCyclePresses returns 0 when already at the target level', () => {
  assert.equal(computeCyclePresses(1, 1, 3), 0);
});

test('computeStepPresses steps directly in either direction without wrapping', () => {
  assert.deepEqual(computeStepPresses(0, 2), { direction: 'up', presses: 2 });
  assert.deepEqual(computeStepPresses(2, 0), { direction: 'down', presses: 2 });
  assert.deepEqual(computeStepPresses(1, 1), { direction: 'up', presses: 0 });
});

test('an exclusive mode keeps every level above 0% - all of them are running levels', () => {
  // Heat with 2 levels: H1 and H2 are both "heating", neither is off.
  assert.equal(percentForLevel(0, 2, true), 50);
  assert.equal(percentForLevel(1, 2, true), 100);
  assert.equal(levelForPercent(50, 2, true), 0);
  assert.equal(levelForPercent(100, 2, true), 1);
});

test('exclusive percent/level round-trips every level', () => {
  for (const levelCount of [2, 3, 4]) {
    for (let level = 0; level < levelCount; level++) {
      assert.equal(levelForPercent(percentForLevel(level, levelCount, true), levelCount, true), level);
    }
  }
});

test('computeReturnLevel resumes the parked level when the fan remembers it', () => {
  assert.equal(computeReturnLevel(1, 2, true), 1);
  assert.equal(computeReturnLevel(0, 3, true), 0);
});

test('computeReturnLevel advances a level when the returning press also steps (fan #2)', () => {
  // H1 -> fan -> H2 -> fan -> H1 ...
  assert.equal(computeReturnLevel(0, 2, false), 1);
  assert.equal(computeReturnLevel(1, 2, false), 0);
});

test('computeActivationPresses costs one press to re-enter, plus any cycling', () => {
  // Parked on H1, returning press lands on H2, which is the target.
  assert.equal(computeActivationPresses(0, 1, 2, false), 1);
  // Parked on H1, remembering fan lands back on H1 - already the target.
  assert.equal(computeActivationPresses(0, 0, 2, true), 1);
  // Parked on H1, remembering fan lands on H1 but we want H2.
  assert.equal(computeActivationPresses(0, 1, 2, true), 2);
});

test('a mode that powers the fan on but never off has no off level of its own (fan #1)', () => {
  // Speed button runs 1 -> 2 -> 3 -> 1, with a separate off button, so
  // every one of its levels is a running speed.
  assert.equal(modeLevelsAreAllOn({ name: 'Speed', kind: 'levels', powersOn: true }), true);
});

test('a mode whose lowest level powers the fan off does have an off level', () => {
  // off -> 1 -> 2 -> 3 -> off, so level 0 really is off.
  assert.equal(modeLevelsAreAllOn({ name: 'Speed', kind: 'levels', powersOn: true, powersOff: true }), false);
});

test('a mode that does not control power at all keeps level 0 as its off level (cooler)', () => {
  assert.equal(modeLevelsAreAllOn({ name: 'Cooler', kind: 'levels' }), false);
});

test('every level of an exclusive mode is a running level', () => {
  assert.equal(modeLevelsAreAllOn({ name: 'Heat', kind: 'levels', exclusive: true }), true);
});
