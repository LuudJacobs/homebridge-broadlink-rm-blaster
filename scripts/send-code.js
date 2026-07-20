#!/usr/bin/env node

// Standalone diagnostic tool: sends a single hex code directly to a
// Broadlink RM, bypassing Homebridge/HomeKit entirely (no debounce, no
// spurious writes, no accessory state). Useful for testing how the
// physical receiver reacts to one signal - or a specific sequence of them
// run by hand - in isolation.
//
// Usage:
//   node scripts/send-code.js <ip> <hexCode>
//   npm run send-code -- <ip> <hexCode>

const Broadlink = require('kiwicam-broadlinkjs-rm');

const MANUAL_RM_DEVICE_TYPE = 0x2227;
const BROADLINK_PORT = 80;
const TIMEOUT_MS = 10_000;

function parseHexCode(hexCode) {
  return Buffer.from(hexCode.replace(/\s+/g, ''), 'hex');
}

function main() {
  const [ip, hexCode] = process.argv.slice(2);

  if (!ip || !hexCode) {
    console.error('Usage: node scripts/send-code.js <ip> <hexCode>');
    process.exit(1);
  }

  const broadlink = new Broadlink();

  const timeout = setTimeout(() => {
    console.error(`Timed out connecting to Broadlink RM at ${ip}`);
    process.exit(1);
  }, TIMEOUT_MS);

  broadlink.on('deviceReady', async (device) => {
    if (device.host.address !== ip) {
      return;
    }
    clearTimeout(timeout);

    console.log(`Connected to Broadlink RM at ${ip}`);
    try {
      await device.sendData(parseHexCode(hexCode));
      console.log(`Sent ${hexCode} to ${ip}`);
      process.exit(0);
    } catch (error) {
      console.error(`Failed to send code: ${error.message}`);
      process.exit(1);
    }
  });

  broadlink.addDevice({ address: ip, port: BROADLINK_PORT }, Buffer.alloc(6, 0), MANUAL_RM_DEVICE_TYPE);
}

main();
