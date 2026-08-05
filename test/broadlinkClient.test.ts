import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFindRfPacket } from '../src/broadlinkClient';

test('buildFindRfPacket is 10 bytes: 2-byte length + 4-byte command + 4-byte data', () => {
  const packet = buildFindRfPacket(433.92);
  assert.equal(packet.length, 10);
});

test('buildFindRfPacket encodes the length prefix as data.length + 4', () => {
  const packet = buildFindRfPacket(433.92);
  assert.equal(packet.readUInt16LE(0), 8);
});

test('buildFindRfPacket encodes the command as a full 4-byte little-endian 0x1b', () => {
  const packet = buildFindRfPacket(433.92);
  assert.equal(packet.readUInt32LE(2), 0x1b);
});

test('buildFindRfPacket encodes the frequency in kHz as a little-endian uint32 after the command', () => {
  const packet = buildFindRfPacket(433.92);
  assert.equal(packet.readUInt32LE(6), 433920);
});

test('buildFindRfPacket rounds fractional kHz', () => {
  const packet = buildFindRfPacket(315.111);
  assert.equal(packet.readUInt32LE(6), 315111);
});
