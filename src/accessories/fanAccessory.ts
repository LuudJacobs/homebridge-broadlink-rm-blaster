import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { FanAccessoryConfig, FanModeConfig } from '../configTypes';

const DEFAULT_PRESS_INTERVAL_SECONDS = 0.5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ordinary modes treat level 0 as off, so it sits at 0% and the top level
// at 100%. Exclusive modes are different: every one of their levels is a
// running level (a heater on H1 is still heating), and they stop only when
// another exclusive mode takes over - so their lowest level has to sit
// above 0%.
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

// Returning to a displaced exclusive mode costs one press to get back into
// it at all. That press lands either on the level it was left at, or one
// past it on a fan whose mode button also advances a level as it switches
// (H1 -> fan -> H2 -> fan -> H1 ...).
export function computeReturnLevel(storedLevel: number, levelCount: number, remembersOnReturn: boolean): number {
  return remembersOnReturn ? storedLevel : (storedLevel + 1) % levelCount;
}

export function computeActivationPresses(
  storedLevel: number,
  targetLevel: number,
  levelCount: number,
  remembersOnReturn: boolean,
): number {
  const landing = computeReturnLevel(storedLevel, levelCount, remembersOnReturn);
  return 1 + computeCyclePresses(landing, targetLevel, levelCount);
}

// Whether every one of a mode's levels is a running level, rather than
// level 0 meaning the mode is off. True for exclusive modes (a heater on
// its lowest setting is still heating), and inferred for the rest: a mode
// that powers the fan on as you step it up, but doesn't power it off at
// its lowest level, cannot have "off" inside its own cycle - that's a fan
// whose speed button runs 1 -> 2 -> 3 -> 1 with a separate off button.
export function modeLevelsAreAllOn(mode: FanModeConfig): boolean {
  return !!mode.exclusive || (!!mode.powersOn && !mode.powersOff);
}

export class FanAccessory {
  private readonly fanService: Service;
  private readonly modeServices = new Map<string, Service>();
  private readonly intervalMs: number;

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: FanAccessoryConfig,
    private readonly ip: string,
  ) {
    this.intervalMs = (this.config.pressIntervalSeconds ?? DEFAULT_PRESS_INTERVAL_SECONDS) * 1000;

    // Level modes can be exposed as Fanv2 sliders too, and getService()
    // returns the first match for a UUID regardless of subtype - so find
    // the main fan by its lack of a subtype rather than letting a mode's
    // slider get picked up as the fan itself.
    this.fanService = this.accessory.services.find(
      (service) => service.UUID === this.platform.Service.Fanv2.UUID && !service.subtype,
    ) ?? this.accessory.addService(this.platform.Service.Fanv2, this.config.name);
    this.fanService.setPrimaryService(true);
    this.nameService(this.fanService, this.config.name);

    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setActive(value));

    if (this.levelCount(this.config.speed) > 1) {
      this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .onGet(() => this.percentOf(this.config.speed))
        .onSet((value) => this.setSpeedPercent(value));
    }

    if (this.config.swing) {
      this.fanService.getCharacteristic(this.platform.Characteristic.SwingMode)
        .onGet(() => this.getSwingMode())
        .onSet((value) => this.setSwingMode(value));
    }

    for (const mode of this.config.modes ?? []) {
      this.setUpModeService(mode);
    }
  }

  // The Home app labels a bridged accessory's extra services off
  // ConfiguredName, not just Name - without it every switch on a
  // multi-service accessory shows up unlabelled.
  private nameService(service: Service, name: string): void {
    service.setCharacteristic(this.platform.Characteristic.Name, name);
    if (!service.testCharacteristic(this.platform.Characteristic.ConfiguredName)) {
      service.addCharacteristic(this.platform.Characteristic.ConfiguredName);
    }
    service.setCharacteristic(this.platform.Characteristic.ConfiguredName, name);
  }

  private setUpModeService(mode: FanModeConfig): void {
    const label = `${this.config.name} ${mode.name}`;
    const useSlider = mode.kind === 'levels' && mode.exposeAsSlider && this.levelCount(mode) > 1;
    const type = useSlider ? this.platform.Service.Fanv2 : this.platform.Service.Switch;

    const service = this.accessory.getServiceById(type, mode.name)
      ?? this.accessory.addService(type, label, mode.name);
    this.nameService(service, label);
    this.modeServices.set(mode.name, service);

    if (useSlider) {
      service.getCharacteristic(this.platform.Characteristic.Active)
        .onGet(() => (this.isModeOn(mode)
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE))
        .onSet((value) => this.setModeOn(mode, value === this.platform.Characteristic.Active.ACTIVE));
      service.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .onGet(() => this.percentOf(mode))
        .onSet((value) => this.setModePercent(mode, value));
      return;
    }

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.isModeOn(mode))
      .onSet((value) => this.setModeOn(mode, !!value));
  }

  // ---------------------------------------------------------------------
  // Assumed state - nothing is ever read back from the device
  // ---------------------------------------------------------------------

  private levelCount(mode: FanModeConfig): number {
    return mode.kind === 'levels' ? (mode.levelCount ?? 1) : 1;
  }

  private allModes(): FanModeConfig[] {
    return [this.config.speed, ...(this.config.modes ?? [])];
  }

  private getLevel(mode: FanModeConfig): number {
    const levels = this.accessory.context.levels as Record<string, number> | undefined;
    return levels?.[mode.name] ?? 0;
  }

  private setLevel(mode: FanModeConfig, level: number): void {
    const levels = (this.accessory.context.levels ?? {}) as Record<string, number>;
    levels[mode.name] = level;
    this.accessory.context.levels = levels;
  }

  private activeExclusive(): string | undefined {
    return this.accessory.context.activeExclusive as string | undefined;
  }

  // An exclusive mode is running when it holds the exclusive slot; an
  // ordinary mode is running when its level is above its off level.
  private isModeOn(mode: FanModeConfig): boolean {
    if (!this.isOn()) {
      return false;
    }
    if (mode.exclusive) {
      return this.activeExclusive() === mode.name;
    }
    if (modeLevelsAreAllOn(mode)) {
      // No off level of its own - it runs whenever the fan does.
      return true;
    }
    return this.getLevel(mode) > 0;
  }

  private percentOf(mode: FanModeConfig): number {
    if (!this.isModeOn(mode)) {
      return 0;
    }
    return percentForLevel(this.getLevel(mode), this.levelCount(mode), modeLevelsAreAllOn(mode));
  }

  // Hands the exclusive slot to `mode`. Whatever held it keeps its level
  // parked so returning to it later can work out where the fan will land.
  private takeExclusive(mode: FanModeConfig): void {
    if (mode.exclusive) {
      this.accessory.context.activeExclusive = mode.name;
    }
  }

  private isOn(): boolean {
    return !!this.accessory.context.on;
  }

  private getActive(): CharacteristicValue {
    return this.isOn()
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
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
    const power = this.config.power;
    const code = power?.onCode ?? power?.toggleCode;
    if (code) {
      await this.send(code);
      this.accessory.context.on = true;
    } else {
      await this.powerViaMode(true);
    }

    // A fan that forgets its swing state comes back with it off, so
    // reassert it if HomeKit still shows swing as on.
    if (this.config.swing && !this.config.swing.remembersState && this.accessory.context.swingOn) {
      await sleep(this.intervalMs);
      await this.send(this.config.swing.code);
    }
    this.platform.log.info(`Sent On to ${this.config.name}`);
  }

  private async powerOff(): Promise<void> {
    const power = this.config.power;
    const code = power?.offCode ?? power?.toggleCode;
    if (code) {
      await this.send(code);
      this.markPoweredOff();
    } else {
      await this.powerViaMode(false);
    }
    this.platform.log.info(`Sent Off to ${this.config.name}`);
  }

  // Drives whichever mode (or swing) the user flagged as also controlling
  // the fan's power, and records the side effect that has.
  private async powerViaMode(on: boolean): Promise<void> {
    const mode = this.allModes().find((candidate) => (on ? candidate.powersOn : candidate.powersOff));

    if (mode) {
      if (on) {
        await this.driveModeOn(mode);
        this.accessory.context.on = true;
        await this.sendFollowUp(mode);
      } else {
        await this.driveModeOff(mode);
        this.markPoweredOff();
      }
      return;
    }

    const swing = this.config.swing;
    if (swing && (on ? swing.powersOn : swing.powersOff)) {
      await this.send(swing.code);
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

  // Everything the fan doesn't remember comes back at its lowest setting,
  // so drop our assumed state to match rather than pretending otherwise.
  private markPoweredOff(): void {
    this.accessory.context.on = false;
    // A follow-up that only runs once per power cycle is due again.
    this.accessory.context.followUpDone = {};
    for (const mode of this.allModes()) {
      if (!mode.remembersState) {
        this.setLevel(mode, 0);
        if (mode.exclusive && this.activeExclusive() === mode.name) {
          this.accessory.context.activeExclusive = undefined;
        }
      }
    }
  }

  // Turning a mode on while the fan is off would otherwise silently do
  // nothing, so power it on first when that mode isn't the power control.
  private async powerOnFirst(mode: FanModeConfig): Promise<void> {
    if (this.isOn() || mode.powersOn) {
      return;
    }
    await this.powerOn();
    await sleep(this.intervalMs);
  }

  // ---------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------

  // Only ever called when a mode is activated, never for a plain level
  // change - re-sending a thermostat max-out on every nudge of a slider
  // would be both pointless and slow.
  private async sendFollowUp(mode: FanModeConfig): Promise<void> {
    if (!mode.followUp) {
      return;
    }
    const done = (this.accessory.context.followUpDone ?? {}) as Record<string, boolean>;
    if (!mode.followUp.everyActivation && done[mode.name]) {
      return;
    }
    for (let i = 0; i < mode.followUp.pressCount; i++) {
      await sleep(this.intervalMs);
      await this.send(mode.followUp.code);
    }
    done[mode.name] = true;
    this.accessory.context.followUpDone = done;
  }

  // Gets `mode` running. For an exclusive mode that's one press to claim
  // the slot back, landing wherever the fan puts it; for anything else it
  // means going to a level that counts as on.
  private async driveModeOn(mode: FanModeConfig): Promise<void> {
    if (mode.kind === 'onoff') {
      await this.send((mode.onCode ?? '') || (mode.offCode ?? ''));
      this.takeExclusive(mode);
      this.setLevel(mode, 1);
      return;
    }

    const levelCount = this.levelCount(mode);
    if (modeLevelsAreAllOn(mode)) {
      // Entering costs one press; just take whichever level that lands on.
      await this.driveToLevel(mode, this.entryLevel(mode));
      return;
    }

    // Lowest level that still counts as on - turning a mode on shouldn't
    // presume the user wanted it at full blast.
    await this.driveToLevel(mode, Math.min(1, levelCount - 1));
  }

  private async driveModeOff(mode: FanModeConfig): Promise<void> {
    if (mode.kind === 'onoff') {
      await this.send(mode.offCode ?? mode.onCode ?? '');
      this.setLevel(mode, 0);
    } else if (!modeLevelsAreAllOn(mode)) {
      await this.driveToLevel(mode, 0);
    } else if (mode.offCode) {
      await this.send(mode.offCode);
    }
    if (mode.exclusive && this.activeExclusive() === mode.name) {
      this.accessory.context.activeExclusive = undefined;
    }
  }

  // Where the fan lands when this mode is entered from not running. An
  // exclusive mode may advance a level as it is switched back to; anything
  // else resumes whatever level we last tracked for it (already reset to 0
  // by a power cycle the fan doesn't remember).
  private entryLevel(mode: FanModeConfig): number {
    if (mode.exclusive) {
      return computeReturnLevel(this.getLevel(mode), this.levelCount(mode), !!mode.remembersOnReturn);
    }
    return this.getLevel(mode);
  }

  private async driveToLevel(mode: FanModeConfig, targetLevel: number): Promise<void> {
    const levelCount = this.levelCount(mode);

    if (modeLevelsAreAllOn(mode) && !this.isModeOn(mode)) {
      // Not running, so one press to get into it, then cycle to the target.
      await this.repeat(mode.upCode, 1 + computeCyclePresses(this.entryLevel(mode), targetLevel, levelCount));
    } else if (mode.downCode) {
      const { direction, presses } = computeStepPresses(this.getLevel(mode), targetLevel);
      await this.repeat(direction === 'up' ? mode.upCode : mode.downCode, presses);
    } else {
      await this.repeat(mode.upCode, computeCyclePresses(this.getLevel(mode), targetLevel, levelCount));
    }

    this.takeExclusive(mode);
    this.setLevel(mode, targetLevel);
  }

  private async setModeOn(mode: FanModeConfig, on: boolean): Promise<void> {
    if (this.isModeOn(mode) === on) {
      return;
    }

    // A mode with no off level and no off signal of its own can't just be
    // switched off on its own terms.
    if (!on && modeLevelsAreAllOn(mode) && !mode.offCode && !mode.powersOff) {
      if (mode.exclusive) {
        // Left only by turning on a different mode - say so, rather than
        // letting HomeKit drift out of sync with the fan.
        this.platform.log.warn(
          `"${mode.name}" on ${this.config.name} can only be left by turning on another mode - ignoring.`,
        );
        this.pushState();
        return;
      }
      // Its lowest level still runs, so "off" here means the fan is off.
      try {
        await this.powerOff();
      } catch (error) {
        this.fail(error);
      }
      this.pushState();
      return;
    }

    try {
      await this.powerOnFirst(mode);
      if (on) {
        await this.driveModeOn(mode);
        if (mode.powersOn) {
          this.accessory.context.on = true;
        }
        await this.sendFollowUp(mode);
      } else {
        await this.driveModeOff(mode);
        if (mode.powersOff) {
          this.markPoweredOff();
        }
      }
      this.platform.log.info(`Sent ${mode.name} ${on ? 'On' : 'Off'} to ${this.config.name}`);
    } catch (error) {
      this.fail(error);
    }
    this.pushState();
  }

  private async setModeLevel(mode: FanModeConfig, targetLevel: number): Promise<void> {
    if (this.isModeOn(mode) && this.getLevel(mode) === targetLevel) {
      return;
    }
    const wasOff = !this.isModeOn(mode);
    try {
      await this.powerOnFirst(mode);
      await this.driveToLevel(mode, targetLevel);
      if (mode.powersOn) {
        this.accessory.context.on = true;
      }
      // Only when this actually brought the mode up, not for a level nudge.
      if (wasOff) {
        await this.sendFollowUp(mode);
      }
      this.platform.log.info(`Set ${mode.name} to level ${targetLevel} on ${this.config.name}`);
    } catch (error) {
      this.fail(error);
    }
    this.pushState();
  }

  private async setModePercent(mode: FanModeConfig, value: CharacteristicValue): Promise<void> {
    const percent = Number(value);
    if (percent <= 0) {
      await this.setModeOn(mode, false);
      return;
    }
    await this.setModeLevel(mode, levelForPercent(percent, this.levelCount(mode), modeLevelsAreAllOn(mode)));
  }

  private async setSpeedPercent(value: CharacteristicValue): Promise<void> {
    await this.setModePercent(this.config.speed, value);
  }

  private async setSwingMode(value: CharacteristicValue): Promise<void> {
    const swing = this.config.swing;
    if (!swing) {
      return;
    }
    const on = value === this.platform.Characteristic.SwingMode.SWING_ENABLED;
    if (!!this.accessory.context.swingOn === on) {
      return;
    }
    try {
      if (!this.isOn() && on && !swing.powersOn) {
        await this.powerOn();
        await sleep(this.intervalMs);
      }
      await this.send(on ? swing.code : (swing.offCode ?? swing.code));
      this.accessory.context.swingOn = on;
      if (on && swing.powersOn) {
        this.accessory.context.on = true;
      } else if (!on && swing.powersOff) {
        this.markPoweredOff();
      }
      this.platform.log.info(`Sent Swing ${on ? 'On' : 'Off'} to ${this.config.name}`);
    } catch (error) {
      this.fail(error);
    }
    this.pushState();
  }

  // One place to resync every characteristic after any action, since a
  // single press can change power, a mode and swing all at once.
  private pushState(): void {
    this.fanService.updateCharacteristic(this.platform.Characteristic.Active, this.getActive());
    if (this.levelCount(this.config.speed) > 1) {
      this.fanService.updateCharacteristic(
        this.platform.Characteristic.RotationSpeed,
        this.percentOf(this.config.speed),
      );
    }
    if (this.config.swing) {
      this.fanService.updateCharacteristic(this.platform.Characteristic.SwingMode, this.getSwingMode());
    }

    for (const mode of this.config.modes ?? []) {
      const service = this.modeServices.get(mode.name);
      if (!service) {
        continue;
      }
      if (service.UUID === this.platform.Service.Fanv2.UUID) {
        service.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.isModeOn(mode)
            ? this.platform.Characteristic.Active.ACTIVE
            : this.platform.Characteristic.Active.INACTIVE,
        );
        service.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.percentOf(mode));
      } else {
        service.updateCharacteristic(this.platform.Characteristic.On, this.isModeOn(mode));
      }
    }
  }
}
