import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFindRfPacket } from '../src/broadlinkClient';

test('buildFindRfPacket prefixes the request header and command byte', () => {
  const requestHeader = Buffer.from([0x04, 0x00]);
  const packet = buildFindRfPacket(433.92, requestHeader);
  assert.equal(packet[0], 0x04);
  assert.equal(packet[1], 0x00);
  assert.equal(packet[2], 0x1b);
});

test('buildFindRfPacket encodes the frequency in kHz as a little-endian uint32', () => {
  const packet = buildFindRfPacket(433.92, Buffer.alloc(0));
  const frequencyKhz = packet.readUInt32LE(1);
  assert.equal(frequencyKhz, 433920);
});

test('buildFindRfPacket rounds fractional kHz', () => {
  const packet = buildFindRfPacket(315.111, Buffer.alloc(0));
  const frequencyKhz = packet.readUInt32LE(1);
  assert.equal(frequencyKhz, 315111);
});
