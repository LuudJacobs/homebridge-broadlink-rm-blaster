import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMqttCommand } from '../src/mqttCommand';

test('parseMqttCommand reads the documented fan message', () => {
  assert.deepEqual(parseMqttCommand('{"state":"ON", "speed": 100, "swing": "ON"}'), {
    state: 'on',
    speedPercent: 100,
    swing: true,
  });
});

test('parseMqttCommand reads a dimmer message', () => {
  assert.deepEqual(parseMqttCommand('{"state":"ON", "level": 50}'), { state: 'on', levelPercent: 50 });
});

test('parseMqttCommand only reports what the message actually carries', () => {
  assert.deepEqual(parseMqttCommand('{"state":"OFF"}'), { state: 'off' });
  assert.deepEqual(parseMqttCommand('{"speed":50}'), { speedPercent: 50 });
  assert.deepEqual(parseMqttCommand('{"swing":"off"}'), { swing: false });
});

test('parseMqttCommand is lenient about case, booleans and numeric strings', () => {
  assert.deepEqual(parseMqttCommand('{"state":"on","swing":true,"speed":"25"}'), {
    state: 'on',
    speedPercent: 25,
    swing: true,
  });
});

test('parseMqttCommand clamps a percentage outside 0-100', () => {
  assert.equal(parseMqttCommand('{"speed":140}')?.speedPercent, 100);
  assert.equal(parseMqttCommand('{"level":-5}')?.levelPercent, 0);
});

test('parseMqttCommand rejects anything it cannot act on', () => {
  for (const payload of ['', 'not json', '[]', 'null', '{}', '{"nonsense":1}', '{"state":"maybe"}']) {
    assert.equal(parseMqttCommand(payload), undefined, payload);
  }
});
