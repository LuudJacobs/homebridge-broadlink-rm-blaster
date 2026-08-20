import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { BasicAccessoryConfig } from '../configTypes';
import { MqttLink } from '../mqttLink';
import { SwitchCooldown } from '../switchCooldown';

const DEFAULT_SWITCH_COOLDOWN_SECONDS = 1;

// Long enough that HomeKit's own optimistic UI doesn't ignore the update
// that snaps a refused switch back to its real state.
const REJECT_RESET_DELAY_MS = 1000;

export function selectPowerCode(config: Pick<BasicAccessoryConfig, 'powerOnCode' | 'powerOffCode'>, on: boolean): string {
  return on ? config.powerOnCode : (config.powerOffCode ?? config.powerOnCode);
}

// Turning off with no Power Off Signal re-sends Power On, which only turns
// anything off if that signal is a toggle. Name it for what was actually
// sent, so a device that ignores it isn't a mystery in the log.
export function powerSignalName(
  config: Pick<BasicAccessoryConfig, 'powerOnCode' | 'powerOffCode'>,
  on: boolean,
): string {
  if (on) {
    return 'Power On';
  }
  return config.powerOffCode ? 'Power Off' : 'Power On (reused to turn off, no Power Off Signal configured)';
}

export class BasicAccessory {
  private readonly service: Service;
  private readonly mqtt: MqttLink;
  private readonly cooldown: SwitchCooldown;

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: BasicAccessoryConfig,
    private readonly ip: string,
  ) {
    const service = this.getOrCreateService();
    this.service = service;
    service.setCharacteristic(this.platform.Characteristic.Name, this.config.name);
    this.cooldown = new SwitchCooldown((this.config.switchCooldownSeconds ?? DEFAULT_SWITCH_COOLDOWN_SECONDS) * 1000);

    if (this.config.accessoryType === 'outlet') {
      service.setCharacteristic(this.platform.Characteristic.OutletInUse, true);
    }

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.getOn())
      .onSet((value) => this.setOnFromHomeKit(value));

    this.mqtt = new MqttLink(platform, config.name, config, (command) => {
      if (command.state === undefined) {
        return;
      }
      return this.cooldown.applyWhenReady(
        Date.now(),
        command.state === 'on',
        (on) => this.applySetOn(on),
        undefined,
        (error) => this.platform.log.error(`Failed to apply a deferred MQTT On/Off to "${this.config.name}": ${(error as Error).message}`),
      );
    });
  }

  private getOrCreateService(): Service {
    switch (this.config.accessoryType) {
      case 'switch':
        return this.accessory.getService(this.platform.Service.Switch)
          ?? this.accessory.addService(this.platform.Service.Switch);
      case 'outlet':
        return this.accessory.getService(this.platform.Service.Outlet)
          ?? this.accessory.addService(this.platform.Service.Outlet);
      case 'fan':
        return this.accessory.getService(this.platform.Service.Fan)
          ?? this.accessory.addService(this.platform.Service.Fan);
      case 'light':
      default:
        return this.accessory.getService(this.platform.Service.Lightbulb)
          ?? this.accessory.addService(this.platform.Service.Lightbulb);
    }
  }

  // A blaster has no feedback from the device it's controlling, so "On" is an
  // assumed state we track ourselves rather than something read back from hardware.
  private getOn(): CharacteristicValue {
    return Boolean(this.accessory.context.on);
  }

  // A signal within the minimum switch interval is refused - the tile
  // snaps back to its real (unchanged) state shortly after, same
  // "HomeKit's optimistic UI needs a real delay" lesson as every other
  // auto-resetting switch in this codebase - but it isn't just dropped:
  // the first refused signal in a window is still held and applied once
  // the window clears (see SwitchCooldown.applyWhenReady). A same-state
  // request is a pure no-op and never touches the cooldown at all.
  private setOnFromHomeKit(value: CharacteristicValue): void | Promise<void> {
    const on = Boolean(value);
    if (on === this.getOn()) {
      return;
    }
    return this.cooldown.applyWhenReady(
      Date.now(),
      on,
      (v) => this.applySetOn(v),
      () => {
        this.platform.log.warn(`Deferring ${on ? 'On' : 'Off'} for "${this.config.name}" - within the minimum switch interval.`);
        setTimeout(() => this.service.updateCharacteristic(this.platform.Characteristic.On, this.getOn()), REJECT_RESET_DELAY_MS);
      },
      (error) => this.platform.log.error(`Failed to apply a deferred On/Off to "${this.config.name}": ${(error as Error).message}`),
    );
  }

  private async applySetOn(on: boolean): Promise<void> {
    const code = selectPowerCode(this.config, on);

    try {
      await this.platform.broadlinkClient.sendCode(this.ip, code);
      this.accessory.context.on = on;
      this.mqtt.publishState(on);
      this.service.updateCharacteristic(this.platform.Characteristic.On, on);
      this.platform.log.info(`Sent ${powerSignalName(this.config, on)} to ${this.config.name}`);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
