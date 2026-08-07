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

// Press-and-capture only, with a retry offer on failure (e.g. a timeout) -
// no "keep this value?" confirmation, so it's also reusable by a plain
// capture-and-display flow that has no accessory to save it into.
async function captureSignal(
  client: BroadlinkClient,
  ip: string,
  settings: SignalSettings,
  label: string,
): Promise<{ status: 'captured'; hex: string } | { status: 'cancelled' }> {
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
      const retry = await readKey('Enter to retry, or "q" to cancel: ', ['', 'q']);
      if (retry === 'q') {
        return { status: 'cancelled' };
      }
      continue;
    }
    activeAbortController = null;
    return { status: 'captured', hex };
  }
}

async function runLearnLoop(
  client: BroadlinkClient,
  ip: string,
  settings: SignalSettings,
  label: string,
): Promise<LearnOutcome> {
  for (;;) {
    const captured = await captureSignal(client, ip, settings, label);
    if (captured.status === 'cancelled') {
      return { status: 'cancelled' };
    }

    console.log(`Captured: ${captured.hex}`);
    const confirm = await readKey('Enter to keep, "r" to retry, or "q" to cancel this accessory: ', ['', 'r', 'q']);
    if (confirm === 'r') {
      continue;
    }
    if (confirm === 'q') {
      return { status: 'cancelled' };
    }
    return { status: 'learned', hex: captured.hex };
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

  // Narrowed to the signal fields, so a non-string config key can't slip in.
  const optionalSignals = [
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
  ] as const satisfies ReadonlyArray<readonly [string, keyof TvAccessoryConfig]>;

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

async function askCount(prompt: string, minimum: number): Promise<number> {
  for (;;) {
    const answer = (await readLine(prompt)).trim();
    const count = Number(answer);
    if (Number.isInteger(count) && count >= minimum) {
      return count;
    }
    console.log(`Enter a whole number of ${minimum} or more.`);
  }
}

async function askYesNo(question: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
  const choice = await readKey(`\n${question}${suffix}`, ['', 'y', 'n']);
  if (choice === '') {
    return defaultYes;
  }
  return choice === 'y';
}

// Learns a control that is either one toggle button or a separate pair.
// Returns undefined if the user cancelled.
async function learnTogglePair(
  client: BroadlinkClient,
  ip: string,
  settings: SignalSettings,
  label: string,
  question: string,
): Promise<{ onCode: string; offCode?: string } | undefined> {
  const separate = await askYesNo(question);
  const on = await learnRequiredSignal(client, ip, settings, separate ? `${label} On` : label);
  if (on.status === 'cancelled') {
    return undefined;
  }
  if (!separate) {
    return { onCode: on.hex };
  }
  const off = await learnRequiredSignal(client, ip, settings, `${label} Off`);
  if (off.status === 'cancelled') {
    return undefined;
  }
  return { onCode: on.hex, offCode: off.hex };
}

type PowerOutcome = { status: 'ok'; power?: FanPowerCodes } | { status: 'cancelled' };

interface FanPowerCodes {
  powerToggleCode?: string;
  powerOnCode?: string;
  powerOffCode?: string;
}

// A signal that can only be skipped when something else already covers
// what it would have done.
async function learnPowerSignal(
  client: BroadlinkClient,
  ip: string,
  settings: SignalSettings,
  label: string,
  skippable: boolean,
): Promise<LearnOutcome | { status: 'skipped' }> {
  if (skippable) {
    return learnOptionalSignal(client, ip, settings, `${label} (skip if the fan has no separate button for this)`);
  }
  return learnRequiredSignal(client, ip, settings, label);
}

// A fan can have a dedicated power button even when a speed, feature or
// swing button already powers it, so this is always offered. Each
// direction can only be skipped when something else already covers it.
async function learnPowerButton(
  client: BroadlinkClient,
  ip: string,
  settings: SignalSettings,
  onCovered: boolean,
  offCovered: boolean,
): Promise<PowerOutcome> {
  if (onCovered && offCovered) {
    if (!(await askYesNo('Does this fan also have a separate power button?'))) {
      return { status: 'ok' };
    }
  }

  const separate = await askYesNo('Are power on and power off separate buttons? (no = one button toggles power)');

  if (!separate) {
    const toggle = await learnPowerSignal(client, ip, settings, 'Power', onCovered && offCovered);
    if (toggle.status === 'cancelled') {
      return { status: 'cancelled' };
    }
    return { status: 'ok', power: toggle.status === 'skipped' ? undefined : { powerToggleCode: toggle.hex } };
  }

  const on = await learnPowerSignal(client, ip, settings, 'Power On', onCovered);
  if (on.status === 'cancelled') {
    return { status: 'cancelled' };
  }
  const off = await learnPowerSignal(client, ip, settings, 'Power Off', offCovered);
  if (off.status === 'cancelled') {
    return { status: 'cancelled' };
  }

  const power: FanPowerCodes = {};
  if (on.status === 'learned') {
    power.powerOnCode = on.hex;
  }
  if (off.status === 'learned') {
    power.powerOffCode = off.hex;
  }
  return { status: 'ok', power: Object.keys(power).length > 0 ? power : undefined };
}

async function learnFan(
  client: BroadlinkClient,
  rmDevices: RmDeviceConfig[],
  pendingItems: PendingItem[],
): Promise<void> {
  const cancelled = () => console.log('Cancelled - nothing saved for this fan.');

  const rmDevice = await pickRmDevice(rmDevices);
  if (!(await connectToDevice(client, rmDevice.ip))) {
    return;
  }
  const name = await askNonEmpty('\nName for this fan: ');
  const settings = await askSignalSettings();

  const item: FanAccessoryConfig = { name, rmDevice: rmDevice.name };

  // Speeds.
  const speedCount = await askCount('\nHow many speeds does this fan have? Minimum 1: ', 1);
  if (speedCount > 1) {
    item.speedCount = speedCount;
    const separate = await askYesNo(
      'Are speed up and speed down separate buttons? (no = one button cycles through the speeds)',
    );
    const up = await learnRequiredSignal(client, rmDevice.ip, settings, separate ? 'Speed Up' : 'Speed');
    if (up.status === 'cancelled') {
      cancelled();
      return;
    }
    item.speedUpCode = up.hex;
    if (separate) {
      const down = await learnRequiredSignal(client, rmDevice.ip, settings, 'Speed Down');
      if (down.status === 'cancelled') {
        cancelled();
        return;
      }
      item.speedDownCode = down.hex;
    }
    item.speedPowersOn = await askYesNo('Does pressing speed up turn the fan on?');
    item.speedPowersOff = await askYesNo('Does going to the lowest speed turn the fan off?');
    item.speedResumes = await askYesNo(
      'When the fan is turned off and back on again, does it remember the speed it was set to? '
      + '(no = it starts at its lowest speed again)',
    );
  } else {
    console.log('\nOne speed, so there is no speed button to learn - the fan is just on or off.');
  }

  // Swing.
  if (await askYesNo('Does this fan have a swing/oscillation function?')) {
    const swing = await learnTogglePair(
      client,
      rmDevice.ip,
      settings,
      'Swing',
      'Are swing on and swing off separate buttons? (no = one button toggles swing)',
    );
    if (!swing) {
      cancelled();
      return;
    }
    item.swingCode = swing.onCode;
    if (swing.offCode) {
      item.swingOffCode = swing.offCode;
    }
    item.swingRemembers = await askYesNo(
      'When the fan is turned off and back on again, is it still swinging?',
    );
    item.swingPowersOn = await askYesNo('Does turning swing on power the fan on?');
    item.swingPowersOff = await askYesNo('Does turning swing off power the fan off?');
  }

  // Extra on/off features.
  const modes: FanModeConfig[] = [];
  let addMore = await askYesNo('Does this fan have any other on/off features (e.g. Cooling, Ioniser)?');
  while (addMore) {
    const modeName = await askNonEmpty('\nName for this feature: ');
    const learned = await learnTogglePair(
      client,
      rmDevice.ip,
      settings,
      modeName,
      `Are "${modeName}" on and off separate buttons? (no = one button toggles it)`,
    );
    if (!learned) {
      cancelled();
      return;
    }

    const mode: FanModeConfig = { name: modeName, onCode: learned.onCode };
    if (learned.offCode) {
      mode.offCode = learned.offCode;
    }
    console.log(`\nThis will show up in the Home app as "${name} ${modeName}".`);
    mode.powersOn = await askYesNo(`Does turning "${modeName}" on power the fan on?`);
    mode.powersOff = await askYesNo(`Does turning "${modeName}" off power the fan off?`);
    mode.remembers = await askYesNo(
      `When the fan is turned off and back on again, is "${modeName}" still on?`,
    );
    modes.push(mode);

    console.log(`\nFeatures so far: ${modes.map((entry) => entry.name).join(', ')}`);
    addMore = await askYesNo('Add another feature?');
  }
  if (modes.length > 0) {
    item.modes = modes;
  }

  // Power. Only the directions nothing else already covers are required.
  const onCovered = !!item.speedPowersOn || !!item.swingPowersOn || modes.some((mode) => mode.powersOn);
  const offCovered = !!item.speedPowersOff || !!item.swingPowersOff || modes.some((mode) => mode.powersOff);

  if (!onCovered && !offCovered) {
    console.log('\nNothing else was said to control power, so this fan needs its own power button.');
  } else if (onCovered !== offCovered) {
    console.log(`\nThe fan already powers ${onCovered ? 'on' : 'off'} via one of the above, so the power `
      + `${onCovered ? 'on' : 'off'} signal can be skipped if it has no separate button for it.`);
  }

  const powerOutcome = await learnPowerButton(client, rmDevice.ip, settings, onCovered, offCovered);
  if (powerOutcome.status === 'cancelled') {
    cancelled();
    return;
  }
  Object.assign(item, powerOutcome.power ?? {});

  // A signal that has to follow every power on.
  if (await askYesNo(
    'When the fan is turned on, is there a button that has to be pressed, possibly more than once? '
    + '(e.g. to set a thermostat)',
  )) {
    const followUpName = await askNonEmpty('\nName for that button: ');
    const followUp = await learnRequiredSignal(client, rmDevice.ip, settings, followUpName);
    if (followUp.status === 'cancelled') {
      cancelled();
      return;
    }
    item.onFollowUpName = followUpName;
    item.onFollowUpCode = followUp.hex;
    item.onFollowUpPressCount = await askCount(`\nHow many times should "${followUpName}" be pressed? Minimum 1: `, 1);
  }

  // Only matters when something actually sends more than one signal in a row.
  const needsInterval = speedCount > 1 || !!item.onFollowUpCode || !!item.swingCode;
  if (needsInterval) {
    item.pressIntervalSeconds = await askTimeoutSeconds();
  }

  item.resyncSwitch = await askYesNo(
    'Expose a resync switch in the Home app? It clears what the plugin thinks this fan is doing, '
    + 'without sending any signals - handy after using the fan\'s own remote',
  );

  // The Home app hides its built-in oscillate control as soon as an
  // accessory carries anything beyond the fan itself, so give swing its
  // own switch in that case. It stays a checkbox in the config UI, so it
  // can be added or removed later without relearning anything.
  if (item.swingCode && (modes.length > 0 || item.resyncSwitch)) {
    item.swingSwitch = true;
    console.log(`\nSwing will also get its own switch ("${name} Swing"), since the Home app hides its built-in `
      + 'oscillate control once an accessory has other switches.');
  }

  pendingItems.push({ type: 'fans', item });
  console.log(`\n"${name}" queued to be saved.`);
}

// Doesn't save anything - just captures one signal and prints it for
// copy/pasting elsewhere (e.g. a config field this walkthrough doesn't
// cover yet).
async function learnHexCode(client: BroadlinkClient, rmDevices: RmDeviceConfig[]): Promise<void> {
  const rmDevice = await pickRmDevice(rmDevices);
  if (!(await connectToDevice(client, rmDevice.ip))) {
    return;
  }
  const settings = await askSignalSettings();

  const captured = await captureSignal(client, rmDevice.ip, settings, 'Signal');
  if (captured.status === 'cancelled') {
    return;
  }

  console.log(`\n${captured.hex}\n`);
  await readKey('Press Enter or "q" to return to the menu: ', ['', 'q']);
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
    console.log('  1. Simple On/Off Accessory');
    console.log('  2. Advanced Accessory (multiple signals per press)');
    console.log('  3. Fan (speeds, modes, swing)');
    console.log('  4. Dimmer Light');
    console.log('  5. TV');
    console.log('  6. Just show hex code');
    console.log('  q. Quit and save');
    const choice = await readKey('Choice: ', ['1', '2', '3', '4', '5', '6', 'q']);

    if (choice === '1') {
      await learnBasicAccessory(client, platform.rmDevices, pendingItems);
    } else if (choice === '2') {
      await learnAdvancedAccessory(client, platform.rmDevices, pendingItems);
    } else if (choice === '3') {
      await learnFan(client, platform.rmDevices, pendingItems);
    } else if (choice === '4') {
      await learnDimmer(client, platform.rmDevices, pendingItems);
    } else if (choice === '5') {
      await learnTv(client, platform.rmDevices, pendingItems);
    } else if (choice === '6') {
      await learnHexCode(client, platform.rmDevices);
    } else {
      break;
    }
  }

  finishAndExit(configPath, pendingItems);
}

if (require.main === module) {
  main();
}
