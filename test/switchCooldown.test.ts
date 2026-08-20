import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SwitchCooldown } from '../src/switchCooldown';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('isReady is true before anything has ever been accepted', () => {
  const cooldown = new SwitchCooldown(1000);
  assert.equal(cooldown.isReady(0), true);
});

test('applyWhenReady applies immediately when the cooldown has already cleared', async () => {
  const cooldown = new SwitchCooldown(1000);
  const applied: boolean[] = [];
  await cooldown.applyWhenReady(0, true, (value) => { applied.push(value); });
  assert.deepEqual(applied, [true]);
  // And clears the window for the next signal, so a second one right after
  // an accepted one is refused again, same as any other accepted transition.
  const refused: boolean[] = [];
  await cooldown.applyWhenReady(1, false, () => {}, () => refused.push(true));
  assert.deepEqual(refused, [true]);
  cooldown.cancelPending();
});

test('applyWhenReady defers the first refused signal until the window clears', async () => {
  const cooldown = new SwitchCooldown(30);
  await cooldown.applyWhenReady(0, true, () => {}); // accepted, starts the window

  const applied: boolean[] = [];
  const refused: number[] = [];
  await cooldown.applyWhenReady(10, false, (value) => { applied.push(value); }, () => refused.push(1));
  assert.deepEqual(applied, [], 'must not apply synchronously while still within the window');
  assert.deepEqual(refused, [1], 'onRefused fires for the signal that is being held');

  await sleep(60);
  assert.deepEqual(applied, [false], 'the held value is applied once the window clears');
});

test('applyWhenReady: only the first signal in a window is held - later ones in the same window are refused and dropped, not queued', async () => {
  const cooldown = new SwitchCooldown(30);
  await cooldown.applyWhenReady(0, true, () => {});

  const applied: boolean[] = [];
  const refusedCount = { n: 0 };
  await cooldown.applyWhenReady(5, false, (value) => { applied.push(value); }, () => { refusedCount.n++; });
  await cooldown.applyWhenReady(10, true, (value) => { applied.push(value); }, () => { refusedCount.n++; });
  await cooldown.applyWhenReady(15, false, (value) => { applied.push(value); }, () => { refusedCount.n++; });

  assert.equal(refusedCount.n, 3, 'onRefused fires for every refused signal, not just the held one');
  assert.deepEqual(applied, [], 'nothing applied synchronously while deferred');

  await sleep(60);
  assert.deepEqual(applied, [false], 'only the first refused value (false) is ever applied, exactly once');
});

test('a burst of refused attempts never pushes the window out further', async () => {
  const cooldown = new SwitchCooldown(1000);
  await cooldown.applyWhenReady(0, true, () => {});

  // A refused attempt right before the window would have cleared.
  let refused = false;
  await cooldown.applyWhenReady(999, false, () => {}, () => { refused = true; });
  assert.equal(refused, true);
  cooldown.cancelPending();

  // The window still clears exactly 1000ms after the original accept, not
  // extended by the attempt above.
  const applied: boolean[] = [];
  await cooldown.applyWhenReady(1000, true, (value) => { applied.push(value); });
  assert.deepEqual(applied, [true]);
});

test('a failure from a deferred apply goes to onDeferredError instead of rejecting', async () => {
  const cooldown = new SwitchCooldown(30);
  await cooldown.applyWhenReady(0, true, () => {});

  const errors: unknown[] = [];
  await cooldown.applyWhenReady(
    10,
    false,
    () => { throw new Error('boom'); },
    () => {},
    (error) => errors.push(error),
  );
  await sleep(60);
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as Error).message, 'boom');
});

test('cancelPending stops a deferred apply from ever firing', async () => {
  const cooldown = new SwitchCooldown(30);
  await cooldown.applyWhenReady(0, true, () => {});

  const applied: boolean[] = [];
  await cooldown.applyWhenReady(10, false, (value) => { applied.push(value); }, () => {});
  cooldown.cancelPending();
  await sleep(60);
  assert.deepEqual(applied, []);
});
