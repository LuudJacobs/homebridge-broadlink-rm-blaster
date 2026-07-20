import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { BrightnessStepDirection, DimmerAccessory } from './dimmerAccessory';

// A momentary trigger, not a persistent toggle: tapping it steps the linked
// dimmer's brightness, then the switch visually resets itself back to off.
export class BrightnessStepSwitchAccessory {
  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly dimmer: DimmerAccessory,
    private readonly direction: BrightnessStepDirection,
    name: string,
  ) {
    const service = this.accessory.getService(this.platform.Service.Lightbulb)
      ?? this.accessory.addService(this.platform.Service.Lightbulb);
    service.setCharacteristic(this.platform.Characteristic.Name, name);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => false)
      .onSet((value) => this.handleSet(value));
  }

  private async handleSet(value: CharacteristicValue): Promise<void> {
    if (!value) {
      return;
    }

    await this.dimmer.stepBrightness(this.direction);

    this.accessory.getService(this.platform.Service.Lightbulb)
      ?.updateCharacteristic(this.platform.Characteristic.On, false);
  }
}
