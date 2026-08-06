import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { FanAccessoryConfig, FanModeConfig } from '../configTypes';

const DEFAULT_PRESS_INTERVAL_SECONDS = 0.5;

// Long enough that HomeKit's own optimistic UI doesn't ignore the update
// that puts a momentary switch back to off.
const RESYNC_RESET_DELAY_MS = 1000;

// Kept distinct from a feature's subtype, which is just its name.
const RESYNC_SUBTYPE = '__resync';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Whether every speed is a running speed, rather than the lowest one being
// the fan switched off. If dropping to the lowest speed turns the fan off
// then that speed *is* off; otherwise the fan's off state sits outside the
// speed cycle entirely (1 -> 2 -> 3 -> 1, with a separate off button).
export function speedsAreAllOn(config: FanAccessoryConfig): boolean {
  return !config.speedPowersOff;
}

// Levels are 0-indexed. With an off level at the bottom, level 0 sits at
// 0% and the top level at 100%; without one, every level is spread above
// 0% so the lowest running speed still reads as on.
export function percentForLevel(level: number, levelCount: number, allLevelsOn = false): number {
  if (allLevelsOn) {
    return Math.round(((level + 1) * 100) / Math.max(levelCount, 1));
  }
  if (levelCount <= 1) {
    return level > 0 ? 100 : 0;
  }
  return Math.round((level * 100) / (levelCount - 1));
}

export function levelForPercent(percent: number, levelCount: number, allLevelsOn = false): number {
  if (allLevelsOn) {
    const level = Math.round((percent * levelCount) / 100) - 1;
    return Math.min(Math.max(level, 0), levelCount - 1);
  }
  if (levelCount <= 1) {
    return percent > 0 ? 1 : 0;
  }
  const level = Math.round((percent * (levelCount - 1)) / 100);
  return Math.min(Math.max(level, 0), levelCount - 1);
}

// Single cycle button: presses only ever go forward, wrapping past the top
// level back to 0.
export function computeCyclePresses(currentLevel: number, targetLevel: number, levelCount: number): number {
  return ((targetLevel - currentLevel) % levelCount + levelCount) % levelCount;
}

// Separate up/down buttons: step directly, no wrapping.
export function computeStepPresses(
  currentLevel: number,
  targetLevel: number,
): { direction: 'up' | 'down'; presses: number } {
  const delta = targetLevel - currentLevel;
  return { direction: delta >= 0 ? 'up' : 'down', presses: Math.abs(delta) };
}

export class FanAccessory {
  private readonly fanService: Service;
  private readonly modeServices = new Map<string, Service>();
  private readonly intervalMs: number;
  private readonly speedCount: number;

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: FanAccessoryConfig,
    private readonly ip: string,
  ) {
    this.intervalMs = (this.config.pressIntervalSeconds ?? DEFAULT_PRESS_INTERVAL_SECONDS) * 1000;
    this.speedCount = this.config.speedCount ?? 1;

    // getService() returns the first match for a UUID regardless of
    // subtype, so find the fan by its lack of one.
    this.fanService = this.accessory.services.find(
      (service) => service.UUID === this.platform.Service.Fanv2.UUID && !service.subtype,
    ) ?? this.accessory.addService(this.platform.Service.Fanv2, this.config.name);
    this.fanService.setPrimaryService(true);
    // Only Name here: the primary service is named by the accessory, and
    // ConfiguredName isn't a characteristic HAP declares for Fanv2.
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, this.config.name);

    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setActive(value));

    if (this.speedCount > 1) {
      this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .onGet(() => this.getSpeedPercent())
        .onSet((value) => this.setSpeedPercent(value));
    }

    if (this.config.swingCode) {
      this.fanService.getCharacteristic(this.platform.Characteristic.SwingMode)
        .onGet(() => this.getSwingMode())
        .onSet((value) => this.setSwingMode(value));
    }

    for (const mode of this.config.modes ?? []) {
      this.setUpModeService(mode);
    }

    if (this.config.resyncSwitch) {
      this.setUpResyncService();
    }

    const modeNames = (this.config.modes ?? []).map((mode) => mode.name);
    this.platform.log.info(
      `Fan "${this.config.name}": ${this.speedCount} speed(s), swing ${this.config.swingCode ? 'yes' : 'no'}`
      + `${modeNames.length > 0 ? `, features: ${modeNames.join(', ')}` : ''}`,
    );
  }

  // Extra services on a bridged accessory are labelled off ConfiguredName,
  // not just Name - without it they show up unlabelled in the Home app.
  private setUpModeService(mode: FanModeConfig): void {
    const label = `${this.config.name} ${mode.name}`;
    const service = this.accessory.getServiceById(this.platform.Service.Switch, mode.name)
      ?? this.accessory.addService(this.platform.Service.Switch, label, mode.name);
    service.setCharacteristic(this.platform.Characteristic.Name, label);
    if (!service.testCharacteristic(this.platform.Characteristic.ConfiguredName)) {
      service.addCharacteristic(this.platform.Characteristic.ConfiguredName);
    }
    service.setCharacteristic(this.platform.Characteristic.ConfiguredName, label);
    this.modeServices.set(mode.name, service);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.isModeOn(mode))
      .onSet((value) => this.setModeOn(mode, !!value));
  }

  // A momentary switch that forgets everything the plugin assumes about
  // this fan, without sending a single signal. Nothing here is ever read
  // back from the device, so using the fan's own remote leaves HomeKit
  // out of step - turn the fan off by hand, tap this, and the two agree
  // again.
  private setUpResyncService(): void {
    const label = `${this.config.name} Resync`;
    const service = this.accessory.getServiceById(this.platform.Service.Switch, RESYNC_SUBTYPE)
      ?? this.accessory.addService(this.platform.Service.Switch, label, RESYNC_SUBTYPE);
    service.setCharacteristic(this.platform.Characteristic.Name, label);
    if (!service.testCharacteristic(this.platform.Characteristic.ConfiguredName)) {
      service.addCharacteristic(this.platform.Characteristic.ConfiguredName);
    }
    service.setCharacteristic(this.platform.Characteristic.ConfiguredName, label);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => false)
      .onSet((value) => {
        if (!value) {
          return;
        }
        this.resyncState();
        // Fire and forget - awaiting this inline would land the update
        // too early for HomeKit to act on it.
        setTimeout(() => {
          service.updateCharacteristic(this.platform.Characteristic.On, false);
        }, RESYNC_RESET_DELAY_MS);
      });
  }

  private resyncState(): void {
    this.accessory.context.on = false;
    this.accessory.context.speedLevel = 0;
    this.accessory.context.speedEntered = false;
    this.accessory.context.swingOn = false;
    this.accessory.context.modes = {};
    this.platform.log.info(`Resynced ${this.config.name} - assuming it is off, with everything cleared.`);
    this.pushState();
  }

  // ---------------------------------------------------------------------
  // Assumed state - nothing is ever read back from the device
  // ---------------------------------------------------------------------

  private isOn(): boolean {
    return !!this.accessory.context.on;
  }

  private getSpeedLevel(): number {
    return (this.accessory.context.speedLevel as number | undefined) ?? 0;
  }

  private setSpeedLevel(level: number): void {
    this.accessory.context.speedLevel = level;
  }

  private isModeOn(mode: FanModeConfig): boolean {
    if (!this.isOn()) {
      return false;
    }
    const modes = this.accessory.context.modes as Record<string, boolean> | undefined;
    return !!modes?.[mode.name];
  }

  private setModeState(mode: FanModeConfig, on: boolean): void {
    const modes = (this.accessory.context.modes ?? {}) as Record<string, boolean>;
    modes[mode.name] = on;
    this.accessory.context.modes = modes;
  }

  private getActive(): CharacteristicValue {
    return this.isOn()
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private getSpeedPercent(): number {
    if (!this.isOn()) {
      return 0;
    }
    return percentForLevel(this.getSpeedLevel(), this.speedCount, speedsAreAllOn(this.config));
  }

  private getSwingMode(): CharacteristicValue {
    return this.accessory.context.swingOn
      ? this.platform.Characteristic.SwingMode.SWING_ENABLED
      : this.platform.Characteristic.SwingMode.SWING_DISABLED;
  }

  private async send(code: string): Promise<void> {
    await this.platform.broadlinkClient.sendCode(this.ip, code);
  }

  private async repeat(code: string | undefined, presses: number): Promise<void> {
    if (!code) {
      return;
    }
    for (let i = 0; i < presses; i++) {
      await this.send(code);
      if (i < presses - 1) {
        await sleep(this.intervalMs);
      }
    }
  }

  private fail(error: unknown): never {
    this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
    const { HapStatusError, HAPStatus } = this.platform.api.hap;
    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  // ---------------------------------------------------------------------
  // Power
  // ---------------------------------------------------------------------

  private async setActive(value: CharacteristicValue): Promise<void> {
    const wantOn = value === this.platform.Characteristic.Active.ACTIVE;
    if (wantOn === this.isOn()) {
      return;
    }
    try {
      if (wantOn) {
        await this.powerOn();
      } else {
        await this.powerOff();
      }
    } catch (error) {
      this.fail(error);
    }
    this.pushState();
  }

  private async powerOn(): Promise<void> {
    const code = this.config.powerOnCode ?? this.config.powerToggleCode;
    if (code) {
      await this.send(code);
      this.accessory.context.on = true;
    } else if (this.config.speedPowersOn && this.speedCount > 1) {
      // The speed button doubles as the power button, so that press is
      // also what gets the fan into its speed cycle.
      await this.repeat(this.config.speedUpCode, 1);
      this.accessory.context.on = true;
      this.setSpeedLevel(this.config.speedResumes ? this.getSpeedLevel() : 0);
      this.accessory.context.speedEntered = true;
    } else {
      await this.powerViaModeOrSwing(true);
    }

    await this.enterSpeedIfNeeded();
    await this.afterPowerOn();
    this.platform.log.info(`Sent On to ${this.config.name}`);
  }

  // A fan powered up by its own power button isn't necessarily running
  // yet: on something like a heater, the heat button still has to be
  // pressed to get into heat mode at all. Turning the accessory on should
  // actually start it, so do that press here.
  private async enterSpeedIfNeeded(): Promise<void> {
    if (this.speedCount <= 1 || this.accessory.context.speedEntered) {
      return;
    }
    if (!speedsAreAllOn(this.config) || this.config.speedResumes) {
      // Either the speed cycle contains the off state anyway, or the fan
      // comes back where it left off - nothing to press.
      this.accessory.context.speedEntered = true;
      return;
    }
    await sleep(this.intervalMs);
    await this.repeat(this.config.speedUpCode, 1);
    this.setSpeedLevel(0);
    this.accessory.context.speedEntered = true;
  }

  // Anything the fan forgets comes back off, and the signal that has to
  // follow every power on is sent here.
  private async afterPowerOn(): Promise<void> {
    if (this.config.swingCode && !this.config.swingRemembers && this.accessory.context.swingOn) {
      await sleep(this.intervalMs);
      await this.send(this.config.swingCode);
    }

    if (this.config.onFollowUpCode) {
      const presses = this.config.onFollowUpPressCount ?? 1;
      for (let i = 0; i < presses; i++) {
        await sleep(this.intervalMs);
        await this.send(this.config.onFollowUpCode);
      }
    }
  }

  private async powerOff(): Promise<void> {
    const code = this.config.powerOffCode ?? this.config.powerToggleCode;
    if (code) {
      await this.send(code);
      this.markPoweredOff();
      this.platform.log.info(`Sent Off to ${this.config.name}`);
      return;
    }

    if (this.config.speedPowersOff && this.speedCount > 1) {
      await this.driveToSpeed(0);
      this.markPoweredOff();
      this.platform.log.info(`Sent Off to ${this.config.name}`);
      return;
    }

    await this.powerViaModeOrSwing(false);
    this.platform.log.info(`Sent Off to ${this.config.name}`);
  }

  private async powerViaModeOrSwing(on: boolean): Promise<void> {
    const mode = (this.config.modes ?? []).find((candidate) => (on ? candidate.powersOn : candidate.powersOff));
    if (mode) {
      await this.send(on ? mode.onCode : (mode.offCode ?? mode.onCode));
      this.setModeState(mode, on);
      if (on) {
        this.accessory.context.on = true;
      } else {
        this.markPoweredOff();
      }
      return;
    }

    const swingCode = this.config.swingCode;
    if (swingCode && (on ? this.config.swingPowersOn : this.config.swingPowersOff)) {
      await this.send(on ? swingCode : (this.config.swingOffCode ?? swingCode));
      this.accessory.context.swingOn = on;
      if (on) {
        this.accessory.context.on = true;
      } else {
        this.markPoweredOff();
      }
      return;
    }

    this.platform.log.warn(`No way to turn ${on ? 'on' : 'off'} "${this.config.name}" - check its configuration.`);
  }

  private markPoweredOff(): void {
    this.accessory.context.on = false;
    this.accessory.context.speedEntered = false;
    if (!this.config.speedResumes) {
      this.setSpeedLevel(0);
    }
    if (!this.config.swingRemembers) {
      this.accessory.context.swingOn = false;
    }
    for (const mode of this.config.modes ?? []) {
      if (!mode.remembers) {
        this.setModeState(mode, false);
      }
    }
  }

  // Turning something on while the fan is off would otherwise silently do
  // nothing, so power it up first unless that action is itself the power
  // control.
  private async powerOnFirst(isPowerControl: boolean): Promise<boolean> {
    if (this.isOn() || isPowerControl) {
      return false;
    }
    await this.powerOn();
    await sleep(this.intervalMs);
    return true;
  }

  // ---------------------------------------------------------------------
  // Speed
  // ---------------------------------------------------------------------

  // The first press after a power cycle gets the fan into its speed cycle
  // rather than stepping within it, so it costs one press on top of the
  // stepping - see enterSpeedIfNeeded.
  private async driveToSpeed(targetLevel: number): Promise<void> {
    const current = this.getSpeedLevel();
    const entryPress = speedsAreAllOn(this.config) && !this.accessory.context.speedEntered;

    if (entryPress) {
      await this.repeat(this.config.speedUpCode, 1 + computeCyclePresses(current, targetLevel, this.speedCount));
    } else if (this.config.speedDownCode) {
      const { direction, presses } = computeStepPresses(current, targetLevel);
      await this.repeat(direction === 'up' ? this.config.speedUpCode : this.config.speedDownCode, presses);
    } else {
      await this.repeat(this.config.speedUpCode, computeCyclePresses(current, targetLevel, this.speedCount));
    }

    this.setSpeedLevel(targetLevel);
    this.accessory.context.speedEntered = true;
  }

  private async setSpeedPercent(value: CharacteristicValue): Promise<void> {
    const percent = Number(value);
    const allOn = speedsAreAllOn(this.config);

    if (percent <= 0) {
      // 0% on a fan whose speeds are all running speeds means switch off.
      if (allOn) {
        await this.setActive(this.platform.Characteristic.Active.INACTIVE);
        return;
      }
      await this.setSpeedLevel0();
      return;
    }

    const targetLevel = levelForPercent(percent, this.speedCount, allOn);
    if (this.isOn() && this.getSpeedLevel() === targetLevel) {
      return;
    }

    try {
      await this.powerOnFirst(!!this.config.speedPowersOn);
      await this.driveToSpeed(targetLevel);
      this.accessory.context.on = true;
      this.platform.log.info(`Set speed to level ${targetLevel} on ${this.config.name}`);
    } catch (error) {
      this.fail(error);
    }
    this.pushState();
  }

  private async setSpeedLevel0(): Promise<void> {
    if (this.getSpeedLevel() === 0 && this.isOn()) {
      return;
    }
    try {
      await this.driveToSpeed(0);
      if (this.config.speedPowersOff) {
        this.markPoweredOff();
      }
      this.platform.log.info(`Set speed to level 0 on ${this.config.name}`);
    } catch (error) {
      this.fail(error);
    }
    this.pushState();
  }

  // ---------------------------------------------------------------------
  // Extra on/off features
  // ---------------------------------------------------------------------

  private async setModeOn(mode: FanModeConfig, on: boolean): Promise<void> {
    if (this.isModeOn(mode) === on) {
      return;
    }
    try {
      await this.powerOnFirst(on ? !!mode.powersOn : !!mode.powersOff);
      await this.send(on ? mode.onCode : (mode.offCode ?? mode.onCode));
      this.setModeState(mode, on);
      if (on && mode.powersOn) {
        this.accessory.context.on = true;
      } else if (!on && mode.powersOff) {
        this.markPoweredOff();
      }
      this.platform.log.info(`Sent ${mode.name} ${on ? 'On' : 'Off'} to ${this.config.name}`);
    } catch (error) {
      this.fail(error);
    }
    this.pushState();
  }

  private async setSwingMode(value: CharacteristicValue): Promise<void> {
    const swingCode = this.config.swingCode;
    if (!swingCode) {
      return;
    }
    const on = value === this.platform.Characteristic.SwingMode.SWING_ENABLED;
    if (!!this.accessory.context.swingOn === on) {
      return;
    }
    try {
      await this.powerOnFirst(on ? !!this.config.swingPowersOn : !!this.config.swingPowersOff);
      await this.send(on ? swingCode : (this.config.swingOffCode ?? swingCode));
      this.accessory.context.swingOn = on;
      if (on && this.config.swingPowersOn) {
        this.accessory.context.on = true;
      } else if (!on && this.config.swingPowersOff) {
        this.markPoweredOff();
      }
      this.platform.log.info(`Sent Swing ${on ? 'On' : 'Off'} to ${this.config.name}`);
    } catch (error) {
      this.fail(error);
    }
    this.pushState();
  }

  // One place to resync every characteristic after any action, since a
  // single press can change power, a feature and swing all at once.
  private pushState(): void {
    this.fanService.updateCharacteristic(this.platform.Characteristic.Active, this.getActive());
    if (this.speedCount > 1) {
      this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getSpeedPercent());
    }
    if (this.config.swingCode) {
      this.fanService.updateCharacteristic(this.platform.Characteristic.SwingMode, this.getSwingMode());
    }
    for (const mode of this.config.modes ?? []) {
      this.modeServices.get(mode.name)
        ?.updateCharacteristic(this.platform.Characteristic.On, this.isModeOn(mode));
    }
  }
}
