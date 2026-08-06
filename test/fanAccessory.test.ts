import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeCyclePresses } from '../src/accessories/fanAccessory';

test('computeCyclePresses returns 0 when already at the target level', () => {
  assert.equal(computeCyclePresses(2, 2, 3), 0);
});

test('computeCyclePresses counts forward presses within the cycle', () => {
  assert.equal(computeCyclePresses(1, 2, 3), 1);
  assert.equal(computeCyclePresses(1, 3, 3), 2);
});

test('computeCyclePresses wraps at the top back to level 1 (fan #1 worked example)', () => {
  // off -> 1 -> 2 -> 3 -> 1 -> 2 -> 3 -> ... - from level 3, one more press wraps to 1.
  assert.equal(computeCyclePresses(3, 1, 3), 1);
  assert.equal(computeCyclePresses(2, 1, 3), 2);
});

test('computeCyclePresses on a 2-level toggle always takes exactly 1 press to flip (fan #2 worked example)', () => {
  assert.equal(computeCyclePresses(1, 2, 2), 1);
  assert.equal(computeCyclePresses(2, 1, 2), 1);
});
