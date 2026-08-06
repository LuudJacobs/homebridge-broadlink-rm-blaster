import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { FanAccessoryConfig, FanModeConfig } from '../configTypes';

const DEFAULT_PRESS_INTERVAL_SECONDS = 0.5;

// Same reset delay/shape already confirmed necessary for a momentary HomeKit
// switch - see AdvancedAccessory.
const RESET_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// How many presses of a mode's cycle signal are needed to get from
// currentLevel to targetLevel, on a levelCount-sized loop (1-indexed) that
// wraps back to 1 at the top.
export function computeCyclePresses(currentLevel: number, targetLevel: number, levelCount: number): number {
  return ((targetLevel - currentLevel) % levelCount + levelCount) % levelCount;
}

function percentForLevel(level: number, levelCount: number): number {
  return Math.round((level * 100) / levelCount);
}

function levelForPercent(percent: number, levelCount: number): number {
  const level = Math.round((percent * levelCount) / 100);
  return Math.min(Math.max(level, 1), levelCount);
}

export class FanAccessory {
  private readonly fanService: Service;
  private readonly modeServices: Service[] = [];

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: FanAccessoryConfig,
    private readonly ip: string,
  ) {
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2)
      ?? this.accessory.addService(this.platform.Service.Fanv2);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, this.config.name);
    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setActive(value));
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(() => this.getRotationSpeed())
      .onSet((value) => this.setRotationSpeed(value));

    if (this.config.swingOnCode) {
      this.fanService.getCharacteristic(this.platform.Characteristic.SwingMode)
        .onGet(() => this.getSwingMode())
        .onSet((value) => this.setSwingMode(value));
    }

    if (this.config.modes.length > 1) {
      for (const mode of this.config.modes) {
        const service = this.accessory.getService(mode.name)
          ?? this.accessory.addService(this.platform.Service.Switch, mode.name, mode.name);
        service.setCharacteristic(this.platform.Characteristic.Name, mode.name);
        service.getCharacteristic(this.platform.Characteristic.On)
          .onGet(() => false)
          .onSet((value) => this.setModeSwitch(value, mode));
        this.modeServices.push(service);
      }
    }
  }

  private getActive(): CharacteristicValue {
    return this.accessory.context.activeModeIndex !== undefined
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private getRotationSpeed(): CharacteristicValue {
    const modeIndex = this.accessory.context.activeModeIndex;
    if (modeIndex === undefined) {
      return 0;
    }
    const mode = this.config.modes[modeIndex];
    const level = this.accessory.context.assumedLevel ?? 1;
    return percentForLevel(level, mode.levelCount);
  }

  private getSwingMode(): CharacteristicValue {
    return this.accessory.context.swingOn
      ? this.platform.Characteristic.SwingMode.SWING_ENABLED
      : this.platform.Characteristic.SwingMode.SWING_DISABLED;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    if (value !== this.platform.Characteristic.Active.ACTIVE) {
      await this.turnOff();
      return;
    }

    const modeIndex = this.accessory.context.activeModeIndex ?? 0;
    await this.enterMode(modeIndex);
  }

  private async turnOff(): Promise<void> {
    try {
      await this.platform.broadlinkClient.sendCode(this.ip, this.config.offCode);
      this.accessory.context.activeModeIndex = undefined;
      this.platform.log.info(`Sent Off to ${this.config.name}`);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async setModeSwitch(value: CharacteristicValue, mode: FanModeConfig): Promise<void> {
    if (!value) {
      return;
    }

    const modeIndex = this.config.modes.indexOf(mode);
    await this.enterMode(modeIndex);

    const service = this.modeServices[modeIndex];
    setTimeout(() => {
      service.updateCharacteristic(this.platform.Characteristic.On, false);
    }, RESET_DELAY_MS);
  }

  // Switches into `modeIndex`, sending enterCode (and any additionalEnterCode
  // repeats) - but only if a different mode (or no mode/off) is currently
  // assumed active. On both real devices this plan was designed against,
  // enterCode and cycleCode are the *same* physical signal - re-sending it
  // while already in this mode would actually cycle the speed on the real
  // hardware, not harmlessly re-confirm the mode, so re-entering an
  // already-active mode is a deliberate no-op.
  private async enterMode(modeIndex: number): Promise<void> {
    if (this.accessory.context.activeModeIndex === modeIndex) {
      return;
    }

    const mode = this.config.modes[modeIndex];
    const intervalMs = (this.config.pressIntervalSeconds ?? DEFAULT_PRESS_INTERVAL_SECONDS) * 1000;

    try {
      await this.platform.broadlinkClient.sendCode(this.ip, mode.enterCode);
      if (mode.additionalEnterCode) {
        const repeatCount = mode.additionalEnterRepeatCount ?? 1;
        for (let i = 0; i < repeatCount; i++) {
          await sleep(intervalMs);
          await this.platform.broadlinkClient.sendCode(this.ip, mode.additionalEnterCode);
        }
      }
      this.accessory.context.activeModeIndex = modeIndex;
      this.accessory.context.assumedLevel = 1;
      this.platform.log.info(`Entered mode "${mode.name}" on ${this.config.name}`);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.fanService.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE);
    this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, percentForLevel(1, mode.levelCount));
  }

  private async setRotationSpeed(value: CharacteristicValue): Promise<void> {
    const modeIndex = this.accessory.context.activeModeIndex;
    if (modeIndex === undefined) {
      return;
    }

    const mode = this.config.modes[modeIndex];
    const targetLevel = levelForPercent(Number(value), mode.levelCount);
    const currentLevel = this.accessory.context.assumedLevel ?? 1;
    const presses = computeCyclePresses(currentLevel, targetLevel, mode.levelCount);
    if (presses === 0) {
      return;
    }

    const cycleCode = mode.cycleCode ?? mode.enterCode;
    const intervalMs = (this.config.pressIntervalSeconds ?? DEFAULT_PRESS_INTERVAL_SECONDS) * 1000;

    try {
      for (let i = 0; i < presses; i++) {
        await this.platform.broadlinkClient.sendCode(this.ip, cycleCode);
        if (i < presses - 1) {
          await sleep(intervalMs);
        }
      }
      this.accessory.context.assumedLevel = targetLevel;
      this.platform.log.info(`Set "${mode.name}" to level ${targetLevel} on ${this.config.name}`);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async setSwingMode(value: CharacteristicValue): Promise<void> {
    const on = value === this.platform.Characteristic.SwingMode.SWING_ENABLED;
    const code = on ? this.config.swingOnCode : (this.config.swingOffCode ?? this.config.swingOnCode);
    if (!code) {
      return;
    }

    try {
      await this.platform.broadlinkClient.sendCode(this.ip, code);
      this.accessory.context.swingOn = on;
      this.platform.log.info(`Sent Swing ${on ? 'On' : 'Off'} to ${this.config.name}`);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
