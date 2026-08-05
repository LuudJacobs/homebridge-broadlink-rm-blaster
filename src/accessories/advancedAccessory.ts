import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { AdvancedAccessoryConfig } from '../configTypes';

const DEFAULT_TIMEOUT_SECONDS = 0.5;

// How long to wait before resetting an auto-resetting (no offCode) trigger
// back to off. Not a stylistic choice - HomeKit's own optimistic UI update
// ignores a follow-up characteristic update that arrives too soon after the
// triggering write, so the tile visually sticks "on" unless this is a real
// delay (same lesson learned from this project's old dimmer up/down
// switches, removed in v0.7.0, but the timing constraint still applies to
// any momentary HomeKit switch).
const RESET_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AdvancedAccessory {
  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: AdvancedAccessoryConfig,
    private readonly ip: string,
  ) {
    const service = this.accessory.getService(this.platform.Service.Switch)
      ?? this.accessory.addService(this.platform.Service.Switch);
    service.setCharacteristic(this.platform.Characteristic.Name, this.config.name);
    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.getOn())
      .onSet((value) => this.setOn(value));
  }

  // Same as every other blaster accessory - no feedback from the device
  // being controlled, so "On" is an assumed state we track ourselves.
  private getOn(): CharacteristicValue {
    return Boolean(this.accessory.context.on);
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);

    if (!on) {
      await this.turnOff();
      return;
    }

    try {
      await this.sendSequence();
      this.accessory.context.on = true;
      this.platform.log.info(`Sent signal sequence to ${this.config.name}`);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    if (!this.config.offCode) {
      this.scheduleAutoReset();
    }
  }

  private async turnOff(): Promise<void> {
    if (!this.config.offCode) {
      // Momentary trigger - nothing to send, just reflect the state.
      this.accessory.context.on = false;
      return;
    }

    try {
      await this.platform.broadlinkClient.sendCode(this.ip, this.config.offCode);
      this.accessory.context.on = false;
      this.platform.log.info(`Sent Off to ${this.config.name}`);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async sendSequence(): Promise<void> {
    const timeoutMs = (this.config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    const { signals } = this.config;

    for (let i = 0; i < signals.length; i++) {
      await this.platform.broadlinkClient.sendCode(this.ip, signals[i].code);
      if (i < signals.length - 1) {
        await sleep(timeoutMs);
      }
    }
  }

  private scheduleAutoReset(): void {
    setTimeout(() => {
      this.accessory.context.on = false;
      this.accessory.getService(this.platform.Service.Switch)
        ?.updateCharacteristic(this.platform.Characteristic.On, false);
    }, RESET_DELAY_MS);
  }
}
