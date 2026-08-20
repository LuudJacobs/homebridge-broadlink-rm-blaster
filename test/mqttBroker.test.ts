import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_MQTT_PORT, parseBrokerAddress } from '../src/mqttBroker';

test('parseBrokerAddress reads a plain host:port', () => {
  assert.deepEqual(parseBrokerAddress('localhost:1883'), { host: 'localhost', port: 1883 });
  assert.deepEqual(parseBrokerAddress('192.168.1.50:8883'), { host: '192.168.1.50', port: 8883 });
});

test('parseBrokerAddress falls back to the default port when none is given', () => {
  assert.deepEqual(parseBrokerAddress('localhost'), { host: 'localhost', port: DEFAULT_MQTT_PORT });
});

test('parseBrokerAddress prefers a legacy separate port over the default', () => {
  // An unmigrated config: host in one field, port still in the old one.
  assert.deepEqual(parseBrokerAddress('localhost', 8883), { host: 'localhost', port: 8883 });
});

test('parseBrokerAddress: a port in the address wins over the legacy fallback', () => {
  assert.deepEqual(parseBrokerAddress('localhost:1884', 8883), { host: 'localhost', port: 1884 });
});

test('parseBrokerAddress trims surrounding whitespace', () => {
  assert.deepEqual(parseBrokerAddress('  localhost : 1883 '), { host: 'localhost', port: 1883 });
});

test('parseBrokerAddress returns undefined for nothing usable', () => {
  assert.equal(parseBrokerAddress(undefined), undefined);
  assert.equal(parseBrokerAddress(''), undefined);
  assert.equal(parseBrokerAddress('   '), undefined);
  assert.equal(parseBrokerAddress(':1883'), undefined);
});

test('parseBrokerAddress ignores an unusable port rather than failing outright', () => {
  assert.deepEqual(parseBrokerAddress('localhost:nope'), { host: 'localhost', port: DEFAULT_MQTT_PORT });
  assert.deepEqual(parseBrokerAddress('localhost:0'), { host: 'localhost', port: DEFAULT_MQTT_PORT });
  assert.deepEqual(parseBrokerAddress('localhost:99999'), { host: 'localhost', port: DEFAULT_MQTT_PORT });
});

test('parseBrokerAddress handles a bracketed IPv6 literal, with and without a port', () => {
  assert.deepEqual(parseBrokerAddress('[::1]:8883'), { host: '[::1]', port: 8883 });
  assert.deepEqual(parseBrokerAddress('[::1]'), { host: '[::1]', port: DEFAULT_MQTT_PORT });
});

test('parseBrokerAddress treats a bare IPv6 literal as a host with no port', () => {
  // No brackets, so every colon belongs to the address itself.
  assert.deepEqual(parseBrokerAddress('fe80::1'), { host: 'fe80::1', port: DEFAULT_MQTT_PORT });
});
