#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

import { backupConfig, findConfigPath, findPlatformBlock, writeConfigAtomically } from './configFile';
import type { HomebridgeConfigFile } from './configFile';
import { accessoryUuidSeed, DEVICE_KINDS, generateUuid } from './deviceKinds';
import { PLATFORM_NAME } from './settings';
import { initTerminal, readKey, readLine, setSigintHandler } from './terminal';

const USAGE = 'Usage: broadlink-rm-manager [--config <path>]';

const HELP = `${USAGE}

Lists the accessories this plugin has configured and lets you rename,
remove, or reset them.

Reset clears an accessory's remembered state - this plugin never reads
anything back from a device, so if a fan gets used from its own remote
what HomeKit shows can drift from reality. Resetting puts everything back
to off/0 without sending any signals, so you can line the two up again.

Changes are only written when you quit with "q". A backup is made once per
session, before anything is written, saved alongside your config as
config.json.backup.

Homebridge should be stopped while you use this: it rewrites its own
accessory cache as it runs, and would overwrite a reset.

Options:
  --config <path>   Path to config.json (defaults to ./config.json)
  -h, --help        Show this help message
`;

interface ManagedDevice {
  title: string;
  configKey: string;
  name: string;
  uuid: string;
  entry: Record<string, unknown>;
}

interface CachedAccessory {
  UUID?: string;
  displayName?: string;
  context?: Record<string, unknown>;
}

// Homebridge keeps its accessory cache next to config.json.
function cachedAccessoriesPath(configPath: string): string {
  return path.join(path.dirname(configPath), 'accessories', 'cachedAccessories');
}

function collectDevices(platform: Record<string, unknown>): ManagedDevice[] {
  const devices: ManagedDevice[] = [];
  for (const kind of DEVICE_KINDS) {
    const entries = platform[kind.configKey];
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const entry of entries as Array<Record<string, unknown>>) {
      const name = String(entry.name ?? '(unnamed)');
      devices.push({
        title: kind.title,
        configKey: kind.configKey,
        name,
        uuid: generateUuid(accessoryUuidSeed(kind.uuidPrefix, name)),
        entry,
      });
    }
  }
  return devices;
}

function listDevices(devices: ManagedDevice[]): void {
  if (devices.length === 0) {
    console.log('\nNo accessories configured yet - use broadlink-rm-learner to add some.');
    return;
  }
  let lastTitle = '';
  devices.forEach((device, index) => {
    if (device.title !== lastTitle) {
      console.log(`\n${device.title}`);
      lastTitle = device.title;
    }
    console.log(`  ${index + 1}. ${device.name}`);
  });
}

// Numbers run straight through the whole list rather than restarting per
// heading, so a single number is never ambiguous.
async function pickDevice(devices: ManagedDevice[]): Promise<ManagedDevice | 'quit'> {
  for (;;) {
    listDevices(devices);
    console.log('\n  q. Save and quit');
    const answer = (await readLine('Choice: ')).trim().toLowerCase();
    if (answer === 'q') {
      return 'quit';
    }
    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= devices.length) {
      return devices[index - 1];
    }
    console.log(`\nEnter a number between 1 and ${devices.length}, or "q".`);
  }
}

type DeviceAction = 'back' | 'quit' | 'removed';

async function manageDevice(
  device: ManagedDevice,
  platform: Record<string, unknown>,
  pendingResets: Set<string>,
  changed: () => void,
): Promise<DeviceAction> {
  for (;;) {
    console.log(`\n--- ${device.name} (${device.title}) ---`);
    console.log(`  1. Rename ${device.name}`);
    console.log(`  2. Reset ${device.name}`);
    console.log(`  3. Remove ${device.name}`);
    console.log('  c. Go back');
    console.log('  q. Save and quit');
    const choice = await readKey('Choice: ', ['1', '2', '3', 'c', 'q']);

    if (choice === 'c') {
      return 'back';
    }
    if (choice === 'q') {
      return 'quit';
    }

    if (choice === '1') {
      const newName = (await readLine(`\nNew name for "${device.name}": `)).trim();
      if (!newName) {
        console.log('Nothing entered - name unchanged.');
        continue;
      }
      if (newName === device.name) {
        continue;
      }
      // The HomeKit UUID is derived from the name, so a rename retires the
      // old accessory and adds a new one - worth saying out loud, since it
      // means losing its room and any automations built on it.
      console.log(
        `\nRenaming re-adds "${newName}" as a new accessory in the Home app; "${device.name}" will `
        + 'disappear along with its room assignment and any automations using it.',
      );
      if (await readKey('Enter to rename, or "c" to cancel: ', ['', 'c']) === 'c') {
        continue;
      }
      device.entry.name = newName;
      pendingResets.delete(device.uuid);
      device.name = newName;
      device.uuid = generateUuid(accessoryUuidSeed(
        DEVICE_KINDS.find((kind) => kind.configKey === device.configKey)?.uuidPrefix ?? '',
        newName,
      ));
      changed();
      console.log(`Renamed to "${newName}".`);
      continue;
    }

    if (choice === '2') {
      pendingResets.add(device.uuid);
      changed();
      console.log(`\n"${device.name}" will be reset to off, with every level and mode cleared. No signals are sent.`);
      continue;
    }

    const entries = platform[device.configKey] as Array<Record<string, unknown>> | undefined;
    const index = entries?.indexOf(device.entry) ?? -1;
    if (index === -1) {
      console.log('\nCould not find that accessory in the config anymore.');
      return 'back';
    }
    console.log(`\nThis removes "${device.name}" from your config entirely.`);
    if (await readKey('Enter to remove, or "c" to cancel: ', ['', 'c']) === 'c') {
      continue;
    }
    entries?.splice(index, 1);
    pendingResets.add(device.uuid);
    changed();
    console.log(`Removed "${device.name}".`);
    return 'removed';
  }
}

// Wipes the remembered state of the given accessories in Homebridge's own
// cache. Everything the plugin tracks lives in each accessory's context,
// and it rebuilds the config side of that on startup, so emptying it is
// the whole reset.
function applyResets(configPath: string, uuids: Set<string>): void {
  if (uuids.size === 0) {
    return;
  }
  const cachePath = cachedAccessoriesPath(configPath);
  if (!fs.existsSync(cachePath)) {
    console.log(`\nNo accessory cache at ${cachePath} - nothing to reset (state is already empty).`);
    return;
  }

  let cached: CachedAccessory[];
  try {
    cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (error) {
    console.error(`\nCould not read ${cachePath}: ${(error as Error).message} - skipping the reset.`);
    return;
  }
  if (!Array.isArray(cached)) {
    console.error(`\n${cachePath} isn't in the expected format - skipping the reset.`);
    return;
  }

  let reset = 0;
  for (const accessory of cached) {
    if (accessory.UUID && uuids.has(accessory.UUID)) {
      accessory.context = {};
      reset += 1;
    }
  }

  if (reset === 0) {
    console.log('\nNothing matching was in the accessory cache - that state is already clear.');
    return;
  }

  const tempPath = path.join(path.dirname(cachePath), '.cachedAccessories.tmp');
  fs.writeFileSync(tempPath, JSON.stringify(cached, null, 2));
  fs.renameSync(tempPath, cachePath);
  console.log(`\nReset ${reset} accessor${reset === 1 ? 'y' : 'ies'} in ${cachePath}.`);
}

function finishAndExit(
  configPath: string,
  config: HomebridgeConfigFile,
  pendingResets: Set<string>,
  hasChanges: boolean,
): never {
  if (!hasChanges) {
    console.log('\nNothing changed this session - exiting.');
    process.exit(0);
  }

  writeConfigAtomically(configPath, config);
  console.log(`\nSaved ${configPath}.`);
  applyResets(configPath, pendingResets);
  console.log('\nRestart Homebridge to pick up the changes.');
  process.exit(0);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }

  const configFlagIndex = args.indexOf('--config');
  const explicitConfigPath = configFlagIndex !== -1 ? args[configFlagIndex + 1] : undefined;

  let configPath: string;
  try {
    configPath = findConfigPath(explicitConfigPath);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }

  const config: HomebridgeConfigFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const platform = findPlatformBlock(config);
  if (!platform) {
    console.error(`Could not find a configured "${PLATFORM_NAME}" platform in ${configPath}.`);
    process.exit(1);
  }

  backupConfig(configPath);
  console.log(`Backed up config.json to ${configPath}.backup`);
  console.log('Homebridge should be stopped while you use this, so a reset is not overwritten.');

  const platformRecord = platform as unknown as Record<string, unknown>;
  const pendingResets = new Set<string>();
  let hasChanges = false;
  const changed = () => {
    hasChanges = true;
  };

  initTerminal();
  setSigintHandler(() => {
    console.log('\n\nCtrl-C - stopping.');
    finishAndExit(configPath, config, pendingResets, hasChanges);
  });

  for (;;) {
    const devices = collectDevices(platformRecord);
    if (devices.length === 0) {
      break;
    }
    const picked = await pickDevice(devices);
    if (picked === 'quit') {
      break;
    }
    if (await manageDevice(picked, platformRecord, pendingResets, changed) === 'quit') {
      break;
    }
  }

  finishAndExit(configPath, config, pendingResets, hasChanges);
}

if (require.main === module) {
  main();
}
