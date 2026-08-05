#!/usr/bin/env node

import * as fs from 'fs';
import * as readline from 'readline/promises';

import { BroadlinkClient } from './broadlinkClient';
import { createConsoleLogger } from './cli';
import { backupConfig, findConfigPath, findPlatformBlock, writeConfigAtomically } from './configFile';
import type { HomebridgeConfigFile } from './configFile';
import { PLATFORM_NAME } from './settings';
import type {
  BasicAccessoryConfig,
  BrightnessLevelConfig,
  DimmerAccessoryConfig,
  RmDeviceConfig,
  TvAccessoryConfig,
} from './configTypes';

const USAGE = 'Usage: broadlink-rm-learner [--config <path>]';

const HELP = `${USAGE}

Interactively learns IR/RF codes from a Broadlink RM and adds the finished
accessory straight into your Homebridge config.json - a guided walkthrough
per accessory type, same idea as the learn-broadlink-rm4-codes project but
built in, and it writes the config for you.

A backup is made once per session, before anything is written, saved
alongside your config as config.json.backup.

Options:
  --config <path>   Path to config.json (defaults to ./config.json)
  -h, --help        Show this help message
`;

type SignalType = 'ir' | 'rf';

type LearnOutcome = { status: 'learned'; hex: string } | { status: 'cancelled' };

type PendingItem =
  | { type: 'accessories'; item: BasicAccessoryConfig }
  | { type: 'tvs'; item: TvAccessoryConfig }
  | { type: 'dimmers'; item: DimmerAccessoryConfig };

// Set only for the duration of an in-flight learnIrCode/learnRfCode call, so
// Ctrl-C can abort it cleanly instead of the process just dying mid-learn.
let activeAbortController: AbortController | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function countdown(): Promise<void> {
  for (const n of [3, 2, 1]) {
    console.log(String(n));
    await sleep(1000);
  }
}

async function askChoice(rl: readline.Interface, prompt: string, choices: string[]): Promise<string> {
  for (;;) {
    const answer = (await rl.question(prompt)).trim().toLowerCase();
    if (choices.includes(answer)) {
      return answer;
    }
  }
}

async function askNonEmpty(rl: readline.Interface, prompt: string): Promise<string> {
  for (;;) {
    const answer = (await rl.question(prompt)).trim();
    if (answer) {
      return answer;
    }
    console.log('This field is required.');
  }
}

async function pickRmDevice(rl: readline.Interface, rmDevices: RmDeviceConfig[]): Promise<RmDeviceConfig> {
  console.log('\nWhich RM device?');
  rmDevices.forEach((device, index) => console.log(`  ${index + 1}. ${device.name} (${device.ip})`));
  for (;;) {
    const answer = (await rl.question('Enter a number: ')).trim();
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && rmDevices[index]) {
      return rmDevices[index];
    }
    console.log('Enter a valid number from the list above.');
  }
}

async function askSignalType(rl: readline.Interface): Promise<SignalType> {
  const choice = await askChoice(rl, '\nIs the remote for this accessory IR or RF? [IR/rf] (Enter for IR): ', ['', 'ir', 'rf']);
  return choice === 'rf' ? 'rf' : 'ir';
}

async function runLearnLoop(
  client: BroadlinkClient,
  ip: string,
  signalType: SignalType,
  label: string,
  rl: readline.Interface,
): Promise<LearnOutcome> {
  for (;;) {
    console.log(`\nLearning "${label}"...`);
    await countdown();
    console.log(signalType === 'rf' ? 'Hold the button now (finding frequency)...' : 'Press the button now...');

    const controller = new AbortController();
    activeAbortController = controller;

    let hex: string;
    try {
      hex = signalType === 'rf'
        ? await client.learnRfCode(ip, controller.signal, (phase) => {
          if (phase === 'capture') {
            console.log('Frequency found - press the button again now...');
          }
        })
        : await client.learnIrCode(ip, controller.signal);
    } catch (error) {
      activeAbortController = null;
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'Cancelled') {
        return { status: 'cancelled' };
      }
      console.log(`Failed: ${message}`);
      const retry = await askChoice(rl, 'Enter to retry, or "q" to cancel this accessory: ', ['', 'q']);
      if (retry === 'q') {
        return { status: 'cancelled' };
      }
      continue;
    }
    activeAbortController = null;

    console.log(`Captured: ${hex}`);
    const confirm = await askChoice(rl, 'Enter to keep, "r" to retry, or "q" to cancel this accessory: ', ['', 'r', 'q']);
    if (confirm === 'r') {
      continue;
    }
    if (confirm === 'q') {
      return { status: 'cancelled' };
    }
    return { status: 'learned', hex };
  }
}

async function learnRequiredSignal(
  client: BroadlinkClient,
  ip: string,
  signalType: SignalType,
  label: string,
  rl: readline.Interface,
): Promise<LearnOutcome> {
  return runLearnLoop(client, ip, signalType, label, rl);
}

async function learnOptionalSignal(
  client: BroadlinkClient,
  ip: string,
  signalType: SignalType,
  label: string,
  rl: readline.Interface,
): Promise<LearnOutcome | { status: 'skipped' }> {
  const choice = await askChoice(
    rl,
    `\nLearn "${label}"? Press Enter to learn it, "c" to skip, or "q" to cancel this accessory: `,
    ['', 'c', 'q'],
  );
  if (choice === 'c') {
    return { status: 'skipped' };
  }
  if (choice === 'q') {
    return { status: 'cancelled' };
  }
  return runLearnLoop(client, ip, signalType, label, rl);
}

async function learnBasicAccessory(
  rl: readline.Interface,
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const rmDevice = await pickRmDevice(rl, rmDevices);
  const name = await askNonEmpty(rl, '\nName for this accessory: ');
  const signalType = await askSignalType(rl);

  const powerOn = await learnRequiredSignal(client, rmDevice.ip, signalType, 'Power On', rl);
  if (powerOn.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this accessory.');
    return;
  }

  const powerOff = await learnOptionalSignal(client, rmDevice.ip, signalType, 'Power Off (skip to reuse Power On)', rl);
  if (powerOff.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this accessory.');
    return;
  }

  const item: BasicAccessoryConfig = {
    name,
    rmDevice: rmDevice.name,
    accessoryType: 'light',
    powerOnCode: powerOn.hex,
  };
  if (powerOff.status === 'learned') {
    item.powerOffCode = powerOff.hex;
  }

  pendingItems.push({ type: 'accessories', item });
  console.log(`\n"${name}" queued to be saved.`);
}

async function learnTv(
  rl: readline.Interface,
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const rmDevice = await pickRmDevice(rl, rmDevices);
  const name = await askNonEmpty(rl, '\nName for this TV: ');
  const signalType = await askSignalType(rl);

  const powerOn = await learnRequiredSignal(client, rmDevice.ip, signalType, 'Power On', rl);
  if (powerOn.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this TV.');
    return;
  }

  const item: TvAccessoryConfig = {
    name,
    rmDevice: rmDevice.name,
    powerOnCode: powerOn.hex,
  };

  const optionalSignals: Array<[string, keyof TvAccessoryConfig]> = [
    ['Power Off (skip to reuse Power On)', 'powerOffCode'],
    ['Volume Up', 'volumeUpCode'],
    ['Volume Down', 'volumeDownCode'],
    ['Mute', 'muteCode'],
    ['Arrow Up', 'arrowUpCode'],
    ['Arrow Down', 'arrowDownCode'],
    ['Arrow Left', 'arrowLeftCode'],
    ['Arrow Right', 'arrowRightCode'],
    ['Select', 'selectCode'],
    ['Info', 'infoCode'],
    ['Back', 'backCode'],
    ['Exit', 'exitCode'],
  ];

  for (const [label, field] of optionalSignals) {
    const result = await learnOptionalSignal(client, rmDevice.ip, signalType, label, rl);
    if (result.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this TV.');
      return;
    }
    if (result.status === 'learned') {
      item[field] = result.hex;
    }
  }

  pendingItems.push({ type: 'tvs', item });
  console.log(`\n"${name}" queued to be saved.`);
}

async function askStepCount(rl: readline.Interface): Promise<number> {
  for (;;) {
    const answer = (await rl.question(
      '\nHow many brightness steps, including 100% (e.g. 5 for 20/40/60/80/100)? Minimum 2: ',
    )).trim();
    const steps = Number(answer);
    if (Number.isInteger(steps) && steps >= 2) {
      return steps;
    }
    console.log('Enter a whole number of 2 or more.');
  }
}

async function learnDimmer(
  rl: readline.Interface,
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const rmDevice = await pickRmDevice(rl, rmDevices);
  const name = await askNonEmpty(rl, '\nName for this dimmer light: ');
  const signalType = await askSignalType(rl);

  const requiredSignals: Array<[string, string]> = [
    ['Power On', 'powerOnCode'],
    ['Power Off', 'powerOffCode'],
    ['Brightness 0%', 'zeroPercentCode'],
    ['Brightness 100%', 'hundredPercentCode'],
  ];
  const codes: Record<string, string> = {};

  for (const [label, field] of requiredSignals) {
    const result = await learnRequiredSignal(client, rmDevice.ip, signalType, label, rl);
    if (result.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this dimmer light.');
      return;
    }
    codes[field] = result.hex;
  }

  const steps = await askStepCount(rl);
  const levels: BrightnessLevelConfig[] = [];
  for (let i = 1; i < steps; i++) {
    const percent = Math.round((i * 100) / steps);
    const result = await learnRequiredSignal(client, rmDevice.ip, signalType, `Brightness ${percent}%`, rl);
    if (result.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this dimmer light.');
      return;
    }
    levels.push({ level: percent, code: result.hex });
  }

  const item: DimmerAccessoryConfig = {
    name,
    rmDevice: rmDevice.name,
    powerOnCode: codes.powerOnCode,
    powerOffCode: codes.powerOffCode,
    zeroPercentCode: codes.zeroPercentCode,
    hundredPercentCode: codes.hundredPercentCode,
    levels,
  };

  pendingItems.push({ type: 'dimmers', item });
  console.log(`\n"${name}" queued to be saved.`);
}

function printFallback(pendingItems: PendingItem[]): void {
  console.error('\nHere is what would have been added - add it manually if needed:');
  console.error(JSON.stringify(pendingItems.map((pending) => pending.item), null, 2));
}

function finishAndExit(configPath: string, pendingItems: PendingItem[]): never {
  if (pendingItems.length === 0) {
    console.log('\nNothing learned this session - exiting.');
    process.exit(0);
  }

  let freshConfig: HomebridgeConfigFile;
  try {
    freshConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    console.error(`\nCould not re-read config.json to save: ${(error as Error).message}`);
    printFallback(pendingItems);
    process.exit(1);
  }

  const platform = findPlatformBlock(freshConfig);
  if (!platform) {
    console.error(
      `\nCould not find the "${PLATFORM_NAME}" platform in config.json anymore - not writing, to avoid losing changes.`,
    );
    printFallback(pendingItems);
    process.exit(1);
  }

  const platformRecord = platform as unknown as Record<string, unknown[]>;
  for (const pending of pendingItems) {
    const list = platformRecord[pending.type] ?? [];
    list.push(pending.item);
    platformRecord[pending.type] = list;
  }

  writeConfigAtomically(configPath, freshConfig);
  console.log(`\nSaved ${pendingItems.length} item(s) to ${configPath}. Restart Homebridge to pick up the changes.`);
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
  if (!platform || !platform.rmDevices?.length) {
    console.error(
      `Could not find a configured "${PLATFORM_NAME}" platform with at least one RM device in ${configPath}.\n` +
      'Configure at least one RM device in the Homebridge Config UI X plugin settings first.',
    );
    process.exit(1);
  }

  backupConfig(configPath);
  console.log(`Backed up config.json to ${configPath}.backup`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const client = new BroadlinkClient(createConsoleLogger());
  const pendingItems: PendingItem[] = [];

  rl.on('SIGINT', () => {
    console.log('\n\nCtrl-C - stopping.');
    activeAbortController?.abort();
    finishAndExit(configPath, pendingItems);
  });

  for (;;) {
    console.log('\nWhat would you like to learn?');
    console.log('  1. Basic Accessory (light/switch/outlet/fan)');
    console.log('  2. TV');
    console.log('  3. Dimmer Light');
    console.log('  q. Quit and save');
    const choice = await askChoice(rl, 'Choice: ', ['1', '2', '3', 'q']);

    if (choice === '1') {
      await learnBasicAccessory(rl, client, platform.rmDevices, pendingItems);
    } else if (choice === '2') {
      await learnTv(rl, client, platform.rmDevices, pendingItems);
    } else if (choice === '3') {
      await learnDimmer(rl, client, platform.rmDevices, pendingItems);
    } else {
      break;
    }
  }

  finishAndExit(configPath, pendingItems);
}

if (require.main === module) {
  main();
}
