import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { BroadlinkRM4ProBlasterPlatform } from '../platform';
import type { BasicAccessoryConfig } from '../configTypes';

export function selectPowerCode(config: Pick<BasicAccessoryConfig, 'powerOnCode' | 'powerOffCode'>, on: boolean): string {
  return on ? config.powerOnCode : (config.powerOffCode ?? config.powerOnCode);
}

export class BasicAccessory {
  constructor(
    private readonly platform: BroadlinkRM4ProBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: BasicAccessoryConfig,
    private readonly ip: string,
  ) {
    const service = this.getOrCreateService();
    service.setCharacteristic(this.platform.Characteristic.Name, this.config.name);

    if (this.config.accessoryType === 'outlet') {
      service.setCharacteristic(this.platform.Characteristic.OutletInUse, true);
    }

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.getOn())
      .onSet((value) => this.setOn(value));
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

  private async setOn(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);
    const code = selectPowerCode(this.config, on);

    try {
      await this.platform.broadlinkClient.sendCode(this.ip, code);
      this.accessory.context.on = on;
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
