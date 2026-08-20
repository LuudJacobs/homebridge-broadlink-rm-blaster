import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { FanAccessoryConfig, FanModeConfig } from '../configTypes';
import { MqttLink } from '../mqttLink';
import type { MqttCommand } from '../mqttCommand';
import { SwitchCooldown } from '../switchCooldown';

const DEFAULT_PRESS_INTERVAL_SECONDS = 0.5;
const DEFAULT_SPEED_DEBOUNCE_SECONDS = 0.5;
const DEFAULT_SWITCH_COOLDOWN_SECONDS = 1;

// Long enough that HomeKit's own optimistic UI doesn't ignore the update
// that puts a momentary switch back to off.
const RESYNC_RESET_DELAY_MS = 1000;

// Same lesson, for a signal refused by the switch cooldown instead.
const REJECT_RESET_DELAY_MS = 1000;

// Kept distinct from a feature's subtype, which is just its name.
const RESYNC_SUBTYPE = '__resync';
const SWING_SUBTYPE = '__swing';

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
  private readonly speedDebounceMs: number;
  private readonly speedCount: number;
  private readonly modes: FanModeConfig[];
  private readonly mqtt: MqttLink;
  private readonly cooldown: SwitchCooldown;
  private swingSwitchService?: Service;
  private speedDebounceTimer?: NodeJS.Timeout;
  private pendingSpeedPercent?: number;
  private pendingActive = false;

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: FanAccessoryConfig,
    private readonly ip: string,
  ) {
    this.intervalMs = (this.config.pressIntervalSeconds ?? DEFAULT_PRESS_INTERVAL_SECONDS) * 1000;
    this.speedDebounceMs = (this.config.speedDebounceSeconds ?? DEFAULT_SPEED_DEBOUNCE_SECONDS) * 1000;
    this.speedCount = this.config.speedCount ?? 1;
    this.modes = this.usableModes();
    this.cooldown = new SwitchCooldown((this.config.switchCooldownSeconds ?? DEFAULT_SWITCH_COOLDOWN_SECONDS) * 1000);

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
      .onSet((value) => this.setActiveFromHomeKit(value));

    if (this.speedCount > 1) {
      this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .onGet(() => this.getSpeedPercent())
        .onSet((value) => this.setSpeedPercent(value));
    } else if (this.fanService.testCharacteristic(this.platform.Characteristic.RotationSpeed)) {
      // A speed that used to be configured and no longer is - the
      // characteristic itself sticks around across restarts otherwise.
      this.fanService.removeCharacteristic(this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed));
    }

    if (this.config.swingCode) {
      this.fanService.getCharacteristic(this.platform.Characteristic.SwingMode)
        .onGet(() => this.getSwingMode())
        .onSet((value) => this.setSwingMode(value));
    } else if (this.fanService.testCharacteristic(this.platform.Characteristic.SwingMode)) {
      this.fanService.removeCharacteristic(this.fanService.getCharacteristic(this.platform.Characteristic.SwingMode));
    }

    this.pruneStaleServices();

    for (const mode of this.modes) {
      this.setUpModeService(mode);
    }

    // The Home app only offers its built-in oscillate control while the
    // accessory is nothing but a fan; as soon as it carries extra
    // services that control disappears, so swing can be put on a switch
    // as well.
    if (this.config.swingCode && this.config.swingSwitch) {
      this.setUpSwingSwitch();
    }

    if (this.config.resyncSwitch) {
      this.setUpResyncService();
    }

    this.mqtt = new MqttLink(platform, config.name, config, (command) => this.applyCommand(command));

    const modeNames = this.modes.map((mode) => mode.name);
    this.platform.log.info(
      `Fan "${this.config.name}": ${this.speedCount} speed(s), swing ${this.config.swingCode ? 'yes' : 'no'}`
      + `${modeNames.length > 0 ? `, features: ${modeNames.join(', ')}` : ''}`,
    );
  }

  private async applyCommand(command: MqttCommand): Promise<void> {
    if (command.state === 'off') {
      // Off wins outright; a speed alongside it would just switch the fan
      // straight back on.
      await this.applyMqttActive(false);
      return;
    }
    if (command.state === 'on') {
      await this.applyMqttActive(true);
    }
    if (command.speedPercent !== undefined && this.speedCount > 1) {
      await this.applySpeedPercent(command.speedPercent);
    }
    if (command.swing !== undefined) {
      await this.applySwing(command.swing);
    }
  }

  // A command inside the switch cooldown window isn't dropped, same as a
  // HomeKit one isn't - the first one in a window is held and applied once
  // it clears (see SwitchCooldown.applyWhenReady). No onRefused here, since
  // there's no tile to visually snap back for an MQTT-originated command.
  private applyMqttActive(on: boolean): Promise<void> {
    return this.cooldown.applyWhenReady(
      Date.now(),
      on,
      (v) => this.setActive(v ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE),
      undefined,
      (error) => this.platform.log.error(`Failed to apply a deferred MQTT On/Off to "${this.config.name}": ${(error as Error).message}`),
    );
  }

  // A feature's name becomes its service subtype, and HomeKit rejects a
  // second service of the same type without a unique one - so a nameless
  // entry (an empty row left behind in the config UI, say) would take the
  // whole accessory down. Drop anything unusable, loudly, rather than
  // failing to load the fan at all.
  private usableModes(): FanModeConfig[] {
    const usable: FanModeConfig[] = [];
    const seen = new Set<string>();

    for (const mode of this.config.modes ?? []) {
      const name = (mode?.name ?? '').trim();
      if (!name) {
        // A blank row left behind by the config form, not a mistake.
        this.platform.log.debug(`Ignoring an empty feature on "${this.config.name}" - remove the blank row.`);
        continue;
      }
      if (name === RESYNC_SUBTYPE || name === SWING_SUBTYPE) {
        this.platform.log.warn(`Ignoring feature "${name}" on "${this.config.name}": that name is reserved.`);
        continue;
      }
      if (seen.has(name)) {
        this.platform.log.warn(`Ignoring a second feature called "${name}" on "${this.config.name}" - names must be unique.`);
        continue;
      }
      if (!mode.onCode) {
        this.platform.log.warn(`Ignoring feature "${name}" on "${this.config.name}": it has no On signal.`);
        continue;
      }
      seen.add(name);
      usable.push({ ...mode, name });
    }

    return usable;
  }

  // A mode's Switch service is added under its name as the subtype and
  // never goes away on its own - Homebridge persists every service ever
  // added to an accessory across restarts. If a mode gets renamed, removed,
  // or the swing/resync switch gets unticked, the old service is orphaned:
  // still present in HomeKit with nothing wiring it up this boot, which
  // shows up there as "No Response".
  private pruneStaleServices(): void {
    const wanted = new Set(this.modes.map((mode) => mode.name));
    if (this.config.swingCode && this.config.swingSwitch) {
      wanted.add(SWING_SUBTYPE);
    }
    if (this.config.resyncSwitch) {
      wanted.add(RESYNC_SUBTYPE);
    }

    for (const service of [...this.accessory.services]) {
      if (service.UUID === this.platform.Service.Switch.UUID && !wanted.has(service.subtype ?? '')) {
        this.platform.log.info(`Removing an unused switch on "${this.config.name}" - its feature is no longer configured.`);
        this.accessory.removeService(service);
      }
    }
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

  private setUpSwingSwitch(): void {
    const label = `${this.config.name} Swing`;
    const service = this.accessory.getServiceById(this.platform.Service.Switch, SWING_SUBTYPE)
      ?? this.accessory.addService(this.platform.Service.Switch, label, SWING_SUBTYPE);
    service.setCharacteristic(this.platform.Characteristic.Name, label);
    if (!service.testCharacteristic(this.platform.Characteristic.ConfiguredName)) {
      service.addCharacteristic(this.platform.Characteristic.ConfiguredName);
    }
    service.setCharacteristic(this.platform.Characteristic.ConfiguredName, label);
    this.swingSwitchService = service;

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => !!this.accessory.context.swingOn)
      .onSet((value) => this.applySwing(!!value));
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
    this.cancelPendingSpeed();
    // A resync abandons a held on/off signal too - it exists to forget
    // everything the plugin assumes, and firing a queued signal moments
    // later would immediately contradict that.
    this.cooldown.cancelPending();
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

  // Sliding a fan on sends Active as well as a run of speed values. Acting
  // on Active straight away fires a signal while the user is still
  // dragging, and on a fan whose speed button is also its power button
  // that press is part of the very sequence the slider is about to work
  // out. So let the slider settle and do it all once - turning off stays
  // immediate, since there is nothing to merge it with.
  private setActiveFromHomeKit(value: CharacteristicValue): void | Promise<void> {
    const wantOn = value === this.platform.Characteristic.Active.ACTIVE;
    if (!wantOn || this.speedCount <= 1) {
      return this.setActiveGated(value);
    }
    this.pendingActive = true;
    this.scheduleSpeedApply();
  }

  // The switch-cooldown gate for a HomeKit-originated transition: a signal
  // within the minimum switch interval is refused - the tile snaps back to
  // its real (unchanged) state shortly after, same lesson as every other
  // auto-resetting switch in this codebase - but it isn't just dropped:
  // the first refused signal in a window is still held and applied once
  // the window clears (see SwitchCooldown.applyWhenReady). Shared by the
  // immediate path above and the slider-debounce settle callback below,
  // since both are "about to actually flip power" decision points.
  private async setActiveGated(value: CharacteristicValue): Promise<void> {
    const wantOn = value === this.platform.Characteristic.Active.ACTIVE;
    if (wantOn === this.isOn()) {
      return;
    }
    await this.cooldown.applyWhenReady(
      Date.now(),
      wantOn,
      (v) => this.setActive(v ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE),
      () => {
        this.platform.log.warn(`Deferring ${wantOn ? 'On' : 'Off'} for "${this.config.name}" - within the minimum switch interval.`);
        setTimeout(
          () => this.fanService.updateCharacteristic(this.platform.Characteristic.Active, this.getActive()),
          REJECT_RESET_DELAY_MS,
        );
      },
      (error) => this.platform.log.error(`Failed to apply a deferred On/Off to "${this.config.name}": ${(error as Error).message}`),
    );
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    const wantOn = value === this.platform.Characteristic.Active.ACTIVE;
    if (wantOn === this.isOn()) {
      return;
    }
    if (!wantOn) {
      this.cancelPendingSpeed();
    }
    try {
      if (wantOn) {
        await this.powerOn();
        await this.startSwingIfWanted();
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
    const mode = this.modes.find((candidate) => (on ? candidate.powersOn : candidate.powersOff));
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
    for (const mode of this.modes) {
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

  // Dragging a slider in the Home app produces a value for every position
  // it passes through, and acting on each one would blast the fan with
  // presses for speeds the user never meant to stop at. Wait for it to
  // settle and act on the final value only.
  private setSpeedPercent(value: CharacteristicValue): void {
    this.pendingSpeedPercent = Number(value);
    this.scheduleSpeedApply();
  }

  private scheduleSpeedApply(): void {
    if (this.speedDebounceTimer) {
      clearTimeout(this.speedDebounceTimer);
    }
    this.speedDebounceTimer = setTimeout(() => {
      this.speedDebounceTimer = undefined;
      const percent = this.pendingSpeedPercent;
      const wantOn = this.pendingActive;
      this.pendingSpeedPercent = undefined;
      this.pendingActive = false;

      // A speed covers turning on by itself, so the two never both fire.
      if (percent !== undefined) {
        void this.applySpeedPercent(percent);
      } else if (wantOn) {
        void this.setActiveGated(this.platform.Characteristic.Active.ACTIVE).catch((error) => {
          this.platform.log.error(`Failed to turn on "${this.config.name}": ${(error as Error).message}`);
        });
      }
    }, this.speedDebounceMs);
  }

  private cancelPendingSpeed(): void {
    if (this.speedDebounceTimer) {
      clearTimeout(this.speedDebounceTimer);
      this.speedDebounceTimer = undefined;
    }
    this.pendingSpeedPercent = undefined;
    this.pendingActive = false;
  }

  private async applySpeedPercent(percent: number): Promise<void> {
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

    const wasOff = !this.isOn();
    try {
      await this.powerOnFirst(!!this.config.speedPowersOn);
      await this.driveToSpeed(targetLevel);
      this.accessory.context.on = true;
      this.platform.log.info(`Set speed to level ${targetLevel} on ${this.config.name}`);
      // Only once the speed has settled, so the fan isn't still stepping
      // through speeds when the swing signal lands.
      if (wasOff) {
        await this.startSwingIfWanted();
      }
    } catch (error) {
      // Nothing to throw to - HomeKit was answered when the slider moved.
      this.platform.log.error(`Failed to set speed on "${this.config.name}": ${(error as Error).message}`);
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

  // Starts the fan oscillating when it comes on, for a fan set up to want
  // that. Skipped when it is already swinging, since the signal is usually
  // a toggle and would stop it instead.
  private async startSwingIfWanted(): Promise<void> {
    if (!this.config.swingOnPowerOn || !this.config.swingCode || this.accessory.context.swingOn) {
      return;
    }
    await sleep(this.intervalMs);
    await this.send(this.config.swingCode);
    this.accessory.context.swingOn = true;
    this.platform.log.info(`Sent Swing On to ${this.config.name} (swings on power on)`);
  }

  private async setSwingMode(value: CharacteristicValue): Promise<void> {
    await this.applySwing(value === this.platform.Characteristic.SwingMode.SWING_ENABLED);
  }

  // Shared by the fan's own oscillate control and the bonus swing switch.
  private async applySwing(on: boolean): Promise<void> {
    const swingCode = this.config.swingCode;
    if (!swingCode) {
      return;
    }
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
    this.mqtt.publishState(this.isOn());
    this.fanService.updateCharacteristic(this.platform.Characteristic.Active, this.getActive());
    if (this.speedCount > 1) {
      this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getSpeedPercent());
    }
    if (this.config.swingCode) {
      this.fanService.updateCharacteristic(this.platform.Characteristic.SwingMode, this.getSwingMode());
      this.swingSwitchService
        ?.updateCharacteristic(this.platform.Characteristic.On, !!this.accessory.context.swingOn);
    }
    for (const mode of this.modes) {
      this.modeServices.get(mode.name)
        ?.updateCharacteristic(this.platform.Characteristic.On, this.isModeOn(mode));
    }
  }
}
