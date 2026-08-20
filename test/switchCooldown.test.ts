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

test('tryAcceptNow accepts once, then refuses within the window, then accepts again once it clears', () => {
  const cooldown = new SwitchCooldown(1000);
  assert.equal(cooldown.tryAcceptNow(0), true);
  assert.equal(cooldown.tryAcceptNow(500), false);
  assert.equal(cooldown.tryAcceptNow(999), false);
  assert.equal(cooldown.tryAcceptNow(1000), true);
});

test('a burst of refused attempts never pushes the window out further', () => {
  const cooldown = new SwitchCooldown(1000);
  assert.equal(cooldown.tryAcceptNow(0), true);
  // Repeated attempts throughout the window, all refused.
  for (let now = 100; now < 1000; now += 100) {
    assert.equal(cooldown.tryAcceptNow(now), false);
  }
  // The window still clears exactly 1000ms after the original accept, not
  // extended by any of the attempts above.
  assert.equal(cooldown.tryAcceptNow(1000), true);
});

test('applyWhenReady applies immediately when the cooldown has already cleared', async () => {
  const cooldown = new SwitchCooldown(1000);
  const applied: boolean[] = [];
  await cooldown.applyWhenReady(0, true, (value) => { applied.push(value); });
  assert.deepEqual(applied, [true]);
});

test('applyWhenReady defers until the window clears when called too soon', async () => {
  const cooldown = new SwitchCooldown(30);
  cooldown.tryAcceptNow(0);

  const applied: boolean[] = [];
  const promise = cooldown.applyWhenReady(10, true, (value) => { applied.push(value); });
  assert.deepEqual(applied, [], 'must not apply synchronously while still within the window');

  await promise;
  assert.deepEqual(applied, [], 'the awaited call itself resolves without waiting for the deferred timer');
  await sleep(60);
  assert.deepEqual(applied, [true]);
});

test('applyWhenReady: the most recent value during the deferred window wins, applied exactly once', async () => {
  const cooldown = new SwitchCooldown(30);
  cooldown.tryAcceptNow(0);

  const applied: boolean[] = [];
  await cooldown.applyWhenReady(5, true, (value) => { applied.push(value); });
  await cooldown.applyWhenReady(10, false, (value) => { applied.push(value); });
  await cooldown.applyWhenReady(15, true, (value) => { applied.push(value); });

  assert.deepEqual(applied, [], 'nothing applied synchronously while deferred');
  await sleep(60);
  assert.deepEqual(applied, [true], 'only the most recent held value is applied, exactly once');
});

test('cancelPending stops a deferred apply from ever firing', async () => {
  const cooldown = new SwitchCooldown(30);
  cooldown.tryAcceptNow(0);

  const applied: boolean[] = [];
  await cooldown.applyWhenReady(10, true, (value) => { applied.push(value); });
  cooldown.cancelPending();
  await sleep(60);
  assert.deepEqual(applied, []);
});
