#!/usr/bin/env node

import type { Logger, LogLevel } from 'homebridge';

import { BroadlinkClient } from './broadlinkClient';

const USAGE = 'Usage: broadlink-rm-blaster <ip> <hexCode>';

const HELP = `${USAGE}

Sends a single hex code directly to a Broadlink RM, bypassing Homebridge/HomeKit
entirely (no debounce, no accessory state). Useful for isolating whether a given
signal behaves oddly on the physical receiver itself.

Arguments:
  ip        IP address of the Broadlink RM (e.g. 192.168.1.50)
  hexCode   Hex-encoded signal to send (e.g. 2600...), whitespace is ignored

Options:
  -h, --help   Show this help message
`;

export function isValidHexCode(hexCode: string): boolean {
  const stripped = hexCode.replace(/\s+/g, '');
  return stripped.length > 0 && stripped.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(stripped);
}

function createConsoleLogger(): Logger {
  const noop = (): void => {};
  return {
    prefix: undefined,
    info: (message: string, ...parameters: unknown[]) => console.log(message, ...parameters),
    success: (message: string, ...parameters: unknown[]) => console.log(message, ...parameters),
    warn: (message: string, ...parameters: unknown[]) => console.warn(message, ...parameters),
    error: (message: string, ...parameters: unknown[]) => console.error(message, ...parameters),
    debug: noop,
    log: (level: LogLevel, message: string, ...parameters: unknown[]) =>
      console.log(`[${level}]`, message, ...parameters),
  };
}

async function main(): Promise<void> {
  const [ip, hexCode, ...rest] = process.argv.slice(2);

  if (ip === '-h' || ip === '--help') {
    console.log(HELP);
    process.exit(0);
  }

  if (!ip || !hexCode) {
    console.error(USAGE);
    process.exit(1);
  }

  if (!isValidHexCode(hexCode)) {
    console.error(
      `Invalid hex code: "${hexCode}"\n` +
      'Expected an even number of hex digits (0-9, a-f/A-F), optionally separated by whitespace.',
    );
    process.exit(1);
  }

  if (rest.length > 0) {
    console.warn(`Ignoring extra argument(s): ${rest.join(' ')}`);
  }

  const client = new BroadlinkClient(createConsoleLogger());

  try {
    await client.sendCode(ip, hexCode);
    console.log(`Sent ${hexCode} to ${ip}`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to send code: ${message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
