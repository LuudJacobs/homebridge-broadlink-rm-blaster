import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTopic } from '../src/mqttClient';

test('buildTopic joins the prefix and a plain device name', () => {
  assert.equal(buildTopic('homebridge-broadlink-rm-blaster', 'default'), 'homebridge-broadlink-rm-blaster/default');
});

test('buildTopic lowercases and hyphenates spaces/mixed case', () => {
  assert.equal(buildTopic('prefix', 'Bedroom RM'), 'prefix/bedroom-rm');
});

test('buildTopic collapses non-alphanumeric characters and trims edges', () => {
  assert.equal(buildTopic('prefix', '  Living Room!! (RM4) '), 'prefix/living-room-rm4');
});
