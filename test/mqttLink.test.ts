import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildStatePayload } from '../src/mqttLink';
import { parseMqttCommand } from '../src/mqttCommand';

test('buildStatePayload reports plain on/off when there is nothing else to say', () => {
  assert.deepEqual(buildStatePayload({ on: true }), { state: 'ON' });
  assert.deepEqual(buildStatePayload({ on: false }), { state: 'OFF' });
});

test('buildStatePayload reports a fan speed and swing alongside the state', () => {
  assert.deepEqual(
    buildStatePayload({ on: true, speedPercent: 67, swing: true }),
    { state: 'ON', speed: 67, swing: 'ON' },
  );
  assert.deepEqual(
    buildStatePayload({ on: true, speedPercent: 33, swing: false }),
    { state: 'ON', speed: 33, swing: 'OFF' },
  );
});

test('buildStatePayload reports a dimmer level alongside the state', () => {
  assert.deepEqual(buildStatePayload({ on: true, levelPercent: 50 }), { state: 'ON', level: 50 });
});

test('buildStatePayload omits anything the accessory does not have', () => {
  // A single-speed fan with no swing has neither key.
  assert.deepEqual(buildStatePayload({ on: true, speedPercent: undefined, swing: undefined }), { state: 'ON' });
});

test('buildStatePayload rounds a fractional percentage', () => {
  assert.deepEqual(buildStatePayload({ on: true, speedPercent: 66.6667 }), { state: 'ON', speed: 67 });
  assert.deepEqual(buildStatePayload({ on: true, levelPercent: 33.3333 }), { state: 'ON', level: 33 });
});

test('a published state can be fed straight back as a command', () => {
  // The whole point of matching the command keys: whatever an accessory
  // says about itself is a valid instruction to put it back that way.
  const fanState = buildStatePayload({ on: true, speedPercent: 100, swing: true });
  assert.deepEqual(parseMqttCommand(JSON.stringify(fanState)), {
    state: 'on',
    speedPercent: 100,
    swing: true,
  });

  const dimmerState = buildStatePayload({ on: true, levelPercent: 40 });
  assert.deepEqual(parseMqttCommand(JSON.stringify(dimmerState)), {
    state: 'on',
    levelPercent: 40,
  });

  const offState = buildStatePayload({ on: false });
  assert.deepEqual(parseMqttCommand(JSON.stringify(offState)), { state: 'off' });
});
