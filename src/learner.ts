#!/usr/bin/env node

import * as fs from 'fs';

import { BroadlinkClient } from './broadlinkClient';
import { createConsoleLogger } from './cli';
import { backupConfig, findConfigPath, findPlatformBlock, writeConfigAtomically } from './configFile';
import type { HomebridgeConfigFile } from './configFile';
import { PLATFORM_NAME } from './settings';
import { initTerminal, readKey, readLine, setSigintHandler } from './terminal';
import type {
  AdvancedAccessoryConfig,
  AdvancedSignalConfig,
  BasicAccessoryConfig,
  BrightnessLevelConfig,
  DimmerAccessoryConfig,
  FanAccessoryConfig,
  FanModeConfig,
  RmDeviceConfig,
  TvAccessoryConfig,
} from './configTypes';

const USAGE = 'Usage: broadlink-rm-learner [--config <path>]';

const DEFAULT_RF_FREQUENCY_MHZ = 433.92;
const DEFAULT_TIMEOUT_SECONDS = 0.5;

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

interface SignalSettings {
  signalType: SignalType;
  frequencyMHz?: number;
}

type LearnOutcome = { status: 'learned'; hex: string } | { status: 'cancelled' };

type PendingItem =
  | { type: 'accessories'; item: BasicAccessoryConfig }
  | { type: 'advancedAccessories'; item: AdvancedAccessoryConfig }
  | { type: 'tvs'; item: TvAccessoryConfig }
  | { type: 'dimmers'; item: DimmerAccessoryConfig }
  | { type: 'fans'; item: FanAccessoryConfig };

// Set only for the duration of an in-flight learnIrCode/learnRfCode call, so
// Ctrl-C can abort it cleanly instead of the process just dying mid-learn.
let activeAbortController: AbortController | null = null;

async function askNonEmpty(prompt: string): Promise<string> {
  for (;;) {
    const answer = (await readLine(prompt)).trim();
    if (answer) {
      return answer;
    }
    console.log('This field is required.');
  }
}

async function pickRmDevice(rmDevices: RmDeviceConfig[]): Promise<RmDeviceConfig> {
  console.log('\nWhich RM device?');
  rmDevices.forEach((device, index) => console.log(`  ${index + 1}. ${device.name} (${device.ip})`));
  const choices = rmDevices.map((_, index) => String(index + 1));
  const choice = await readKey('Choice: ', choices);
  return rmDevices[Number(choice) - 1];
}

// Connects (or confirms the cached connection) up front, so "press the
// button now" prompts never appear before the RM is actually ready to
// receive a learning command.
async function connectToDevice(client: BroadlinkClient, ip: string): Promise<boolean> {
  console.log(`\nConnecting to ${ip}...`);
  try {
    await client.connect(ip);
    console.log('Connected.');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Failed to connect: ${message}`);
    return false;
  }
}

async function askFrequency(): Promise<number> {
  for (;;) {
    const answer = (await readLine(`\nRF frequency in MHz (Enter for ${DEFAULT_RF_FREQUENCY_MHZ}): `)).trim();
    if (!answer) {
      return DEFAULT_RF_FREQUENCY_MHZ;
    }
    const frequency = Number(answer);
    if (Number.isFinite(frequency) && frequency > 0) {
      return frequency;
    }
    console.log(`Enter a positive number, e.g. ${DEFAULT_RF_FREQUENCY_MHZ}.`);
  }
}

async function askSignalSettings(): Promise<SignalSettings> {
  const choice = await readKey('\nIs the remote for this accessory IR or RF? [I/r]: ', ['', 'i', 'r']);
  if (choice === 'r') {
    const frequencyMHz = await askFrequency();
    return { signalType: 'rf', frequencyMHz };
  }
  return { signalType: 'ir' };
}

async function runLearnLoop(
  client: BroadlinkClient,
  ip: string,
  settings: SignalSettings,
  label: string,
): Promise<LearnOutcome> {
  for (;;) {
    console.log(
      settings.signalType === 'rf'
        ? `\nLearning "${label}" - press the button now (${settings.frequencyMHz} MHz)...`
        : `\nLearning "${label}" - press the button now...`,
    );

    const controller = new AbortController();
    activeAbortController = controller;

    let hex: string;
    try {
      hex = settings.signalType === 'rf'
        ? await client.learnRfCode(ip, settings.frequencyMHz as number, controller.signal)
        : await client.learnIrCode(ip, controller.signal);
    } catch (error) {
      activeAbortController = null;
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'Cancelled') {
        return { status: 'cancelled' };
      }
      console.log(`Failed: ${message}`);
      const retry = await readKey('Enter to retry, or "q" to cancel this accessory: ', ['', 'q']);
      if (retry === 'q') {
        return { status: 'cancelled' };
      }
      continue;
    }
    activeAbortController = null;

    console.log(`Captured: ${hex}`);
    const confirm = await readKey('Enter to keep, "r" to retry, or "q" to cancel this accessory: ', ['', 'r', 'q']);
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
  settings: SignalSettings,
  label: string,
): Promise<LearnOutcome> {
  return runLearnLoop(client, ip, settings, label);
}

async function learnOptionalSignal(
  client: BroadlinkClient,
  ip: string,
  settings: SignalSettings,
  label: string,
): Promise<LearnOutcome | { status: 'skipped' }> {
  const choice = await readKey(
    `\nLearn "${label}"? Enter to learn it, "s" to skip, or "q" to cancel this accessory: `,
    ['', 's', 'q'],
  );
  if (choice === 's') {
    return { status: 'skipped' };
  }
  if (choice === 'q') {
    return { status: 'cancelled' };
  }
  return runLearnLoop(client, ip, settings, label);
}

async function learnBasicAccessory(
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const rmDevice = await pickRmDevice(rmDevices);
  if (!(await connectToDevice(client, rmDevice.ip))) {
    return;
  }
  const name = await askNonEmpty('\nName for this accessory: ');
  const settings = await askSignalSettings();

  const powerOn = await learnRequiredSignal(client, rmDevice.ip, settings, 'Power On');
  if (powerOn.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this accessory.');
    return;
  }

  const powerOff = await learnOptionalSignal(client, rmDevice.ip, settings, 'Power Off (skip to reuse Power On)');
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

async function askTimeoutSeconds(): Promise<number> {
  for (;;) {
    const answer = (await readLine(`\nTimeout between signals in seconds (Enter for ${DEFAULT_TIMEOUT_SECONDS}): `)).trim();
    if (!answer) {
      return DEFAULT_TIMEOUT_SECONDS;
    }
    const seconds = Number(answer);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds;
    }
    console.log('Enter a number 0 or greater.');
  }
}

async function learnAdvancedAccessory(
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const rmDevice = await pickRmDevice(rmDevices);
  if (!(await connectToDevice(client, rmDevice.ip))) {
    return;
  }
  const name = await askNonEmpty('\nName for this advanced accessory: ');
  const settings = await askSignalSettings();

  const signals: AdvancedSignalConfig[] = [];
  for (;;) {
    const result = await learnRequiredSignal(client, rmDevice.ip, settings, `Signal ${signals.length + 1}`);
    if (result.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this advanced accessory.');
      return;
    }
    signals.push({ code: result.hex });

    const choice = await readKey(
      `\n${signals.length} signal(s) learned. Enter to learn another, "d" when done, or "q" to cancel: `,
      ['', 'd', 'q'],
    );
    if (choice === 'q') {
      console.log('Cancelled - nothing saved for this advanced accessory.');
      return;
    }
    if (choice === 'd') {
      break;
    }
  }

  const off = await learnOptionalSignal(client, rmDevice.ip, settings, 'Off signal (skip for an auto-resetting trigger)');
  if (off.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this advanced accessory.');
    return;
  }

  const item: AdvancedAccessoryConfig = {
    name,
    rmDevice: rmDevice.name,
    signals,
  };
  if (off.status === 'learned') {
    item.offCode = off.hex;
  }
  if (signals.length > 1) {
    item.timeoutSeconds = await askTimeoutSeconds();
  }

  pendingItems.push({ type: 'advancedAccessories', item });
  console.log(`\n"${name}" queued to be saved.`);
}

async function learnTv(
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const rmDevice = await pickRmDevice(rmDevices);
  if (!(await connectToDevice(client, rmDevice.ip))) {
    return;
  }
  const name = await askNonEmpty('\nName for this TV: ');
  const settings = await askSignalSettings();

  const powerOn = await learnRequiredSignal(client, rmDevice.ip, settings, 'Power On');
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
    const result = await learnOptionalSignal(client, rmDevice.ip, settings, label);
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

async function askStepCount(): Promise<number> {
  for (;;) {
    const answer = (await readLine(
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
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const rmDevice = await pickRmDevice(rmDevices);
  if (!(await connectToDevice(client, rmDevice.ip))) {
    return;
  }
  const name = await askNonEmpty('\nName for this dimmer light: ');
  const settings = await askSignalSettings();
  const steps = await askStepCount();

  const requiredSignals: Array<[string, string]> = [
    ['Power On', 'powerOnCode'],
    ['Power Off', 'powerOffCode'],
  ];
  const codes: Record<string, string> = {};

  for (const [label, field] of requiredSignals) {
    const result = await learnRequiredSignal(client, rmDevice.ip, settings, label);
    if (result.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this dimmer light.');
      return;
    }
    codes[field] = result.hex;
  }

  const zero = await learnRequiredSignal(client, rmDevice.ip, settings, 'Brightness 0%');
  if (zero.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this dimmer light.');
    return;
  }
  codes.zeroPercentCode = zero.hex;

  const levels: BrightnessLevelConfig[] = [];
  for (let i = 1; i < steps; i++) {
    const percent = Math.round((i * 100) / steps);
    const result = await learnRequiredSignal(client, rmDevice.ip, settings, `Brightness ${percent}%`);
    if (result.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this dimmer light.');
      return;
    }
    levels.push({ level: percent, code: result.hex });
  }

  const hundred = await learnRequiredSignal(client, rmDevice.ip, settings, 'Brightness 100%');
  if (hundred.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this dimmer light.');
    return;
  }
  codes.hundredPercentCode = hundred.hex;

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

async function askLevelCount(modeName: string): Promise<number> {
  for (;;) {
    const answer = (await readLine(`\nHow many levels/speeds does "${modeName}" cycle through? Minimum 1: `)).trim();
    const count = Number(answer);
    if (Number.isInteger(count) && count >= 1) {
      return count;
    }
    console.log('Enter a whole number of 1 or more.');
  }
}

async function askRepeatCount(): Promise<number> {
  for (;;) {
    const answer = (await readLine('\nHow many times should it be sent (Enter for 1)? ')).trim();
    if (!answer) {
      return 1;
    }
    const count = Number(answer);
    if (Number.isInteger(count) && count >= 1) {
      return count;
    }
    console.log('Enter a whole number of 1 or more.');
  }
}

async function learnFan(
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const rmDevice = await pickRmDevice(rmDevices);
  if (!(await connectToDevice(client, rmDevice.ip))) {
    return;
  }
  const name = await askNonEmpty('\nName for this fan: ');
  const settings = await askSignalSettings();

  const off = await learnRequiredSignal(client, rmDevice.ip, settings, 'Off');
  if (off.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this fan.');
    return;
  }

  let swingOnCode: string | undefined;
  let swingOffCode: string | undefined;
  const swingOn = await learnOptionalSignal(client, rmDevice.ip, settings, 'Swing On (skip if this fan has no swing function)');
  if (swingOn.status === 'cancelled') {
    console.log('Cancelled - nothing saved for this fan.');
    return;
  }
  if (swingOn.status === 'learned') {
    swingOnCode = swingOn.hex;
    const swingOff = await learnOptionalSignal(client, rmDevice.ip, settings, 'Swing Off (skip if pressing Swing On again just toggles it)');
    if (swingOff.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this fan.');
      return;
    }
    if (swingOff.status === 'learned') {
      swingOffCode = swingOff.hex;
    }
  }

  const modes: FanModeConfig[] = [];
  for (;;) {
    const modeName = await askNonEmpty(`\nName for mode ${modes.length + 1} (e.g. Speed, Heat, Fan): `);

    const enter = await learnRequiredSignal(client, rmDevice.ip, settings, `Enter ${modeName}`);
    if (enter.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this fan.');
      return;
    }

    const cycleChoice = await readKey(
      `\nDoes pressing "Enter ${modeName}" again advance to the next level, or is there a separate signal for that? ` +
      '(Enter if it\'s the same signal, "s" if there\'s a separate one): ',
      ['', 's'],
    );
    let cycleCode: string | undefined;
    if (cycleChoice === 's') {
      const cycle = await learnRequiredSignal(client, rmDevice.ip, settings, `Cycle ${modeName}`);
      if (cycle.status === 'cancelled') {
        console.log('Cancelled - nothing saved for this fan.');
        return;
      }
      cycleCode = cycle.hex;
    }

    const levelCount = await askLevelCount(modeName);

    let additionalEnterCode: string | undefined;
    let additionalEnterRepeatCount: number | undefined;
    const additional = await learnOptionalSignal(
      client,
      rmDevice.ip,
      settings,
      `Extra signal to send automatically every time "${modeName}" is freshly entered (e.g. maxing out a target temperature) - skip if none`,
    );
    if (additional.status === 'cancelled') {
      console.log('Cancelled - nothing saved for this fan.');
      return;
    }
    if (additional.status === 'learned') {
      additionalEnterCode = additional.hex;
      additionalEnterRepeatCount = await askRepeatCount();
    }

    const mode: FanModeConfig = {
      name: modeName,
      enterCode: enter.hex,
      levelCount,
    };
    if (cycleCode) {
      mode.cycleCode = cycleCode;
    }
    if (additionalEnterCode) {
      mode.additionalEnterCode = additionalEnterCode;
      mode.additionalEnterRepeatCount = additionalEnterRepeatCount;
    }
    modes.push(mode);

    const choice = await readKey(
      `\n${modes.length} mode(s) added. Enter to add another, "d" when done, or "q" to cancel: `,
      ['', 'd', 'q'],
    );
    if (choice === 'q') {
      console.log('Cancelled - nothing saved for this fan.');
      return;
    }
    if (choice === 'd') {
      break;
    }
  }

  const item: FanAccessoryConfig = {
    name,
    rmDevice: rmDevice.name,
    offCode: off.hex,
    modes,
  };
  if (swingOnCode) {
    item.swingOnCode = swingOnCode;
  }
  if (swingOffCode) {
    item.swingOffCode = swingOffCode;
  }

  const needsInterval = modes.length > 1
    || modes.some((mode) => mode.levelCount > 1)
    || modes.some((mode) => (mode.additionalEnterRepeatCount ?? 0) > 1);
  if (needsInterval) {
    item.pressIntervalSeconds = await askTimeoutSeconds();
  }

  pendingItems.push({ type: 'fans', item });
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

  const client = new BroadlinkClient(createConsoleLogger());
  const pendingItems: PendingItem[] = [];

  initTerminal();
  setSigintHandler(() => {
    console.log('\n\nCtrl-C - stopping.');
    activeAbortController?.abort();
    finishAndExit(configPath, pendingItems);
  });

  for (;;) {
    console.log('\nWhat would you like to learn?');
    console.log('  1. Basic Accessory (light/switch/outlet/fan)');
    console.log('  2. TV');
    console.log('  3. Dimmer Light');
    console.log('  4. Advanced Accessory (multiple signals per press)');
    console.log('  5. Fan (speeds, modes, swing)');
    console.log('  q. Quit and save');
    const choice = await readKey('Choice: ', ['1', '2', '3', '4', '5', 'q']);

    if (choice === '1') {
      await learnBasicAccessory(client, platform.rmDevices, pendingItems);
    } else if (choice === '2') {
      await learnTv(client, platform.rmDevices, pendingItems);
    } else if (choice === '3') {
      await learnDimmer(client, platform.rmDevices, pendingItems);
    } else if (choice === '4') {
      await learnAdvancedAccessory(client, platform.rmDevices, pendingItems);
    } else if (choice === '5') {
      await learnFan(client, platform.rmDevices, pendingItems);
    } else {
      break;
    }
  }

  finishAndExit(configPath, pendingItems);
}

if (require.main === module) {
  main();
}
