import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { BroadlinkRM4ProBlasterPlatform } from '../platform';

const POLL_INTERVAL_MS = 60_000;
const SENSOR_NAME = 'RM4 Pro Sensor';

export class TemperatureHumiditySensorAccessory {
  constructor(
    private readonly platform: BroadlinkRM4ProBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly ip: string,
  ) {
    const temperatureService = this.accessory.getService(this.platform.Service.TemperatureSensor)
      ?? this.accessory.addService(this.platform.Service.TemperatureSensor);
    temperatureService.setCharacteristic(this.platform.Characteristic.Name, SENSOR_NAME);
    temperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(() => this.getTemperature());

    const humidityService = this.accessory.getService(this.platform.Service.HumiditySensor)
      ?? this.accessory.addService(this.platform.Service.HumiditySensor);
    humidityService.setCharacteristic(this.platform.Characteristic.Name, SENSOR_NAME);
    humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(() => this.getHumidity());

    // Not all RM4 Pro units actually report real sensor data ("if available" in
    // the todo) - an immediate poll plus a recurring one lets a supported unit
    // start reporting quickly, while an unsupported one just keeps failing
    // quietly and onGet honestly reports "no response" rather than a fake 0.
    this.poll();
    setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private getTemperature(): CharacteristicValue {
    const temperature = this.accessory.context.temperature;
    if (temperature === undefined) {
      this.throwNoResponse();
    }
    return temperature;
  }

  private getHumidity(): CharacteristicValue {
    const humidity = this.accessory.context.humidity;
    if (humidity === undefined) {
      this.throwNoResponse();
    }
    return humidity;
  }

  private throwNoResponse(): never {
    const { HapStatusError, HAPStatus } = this.platform.api.hap;
    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private async poll(): Promise<void> {
    try {
      const { temperature, humidity } = await this.platform.broadlinkClient.readTemperatureHumidity(this.ip);

      this.accessory.context.temperature = temperature;
      this.accessory.context.humidity = humidity;

      this.accessory.getService(this.platform.Service.TemperatureSensor)
        ?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temperature);
      this.accessory.getService(this.platform.Service.HumiditySensor)
        ?.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
    } catch (error) {
      this.platform.log.warn(`Failed to read temperature/humidity from ${this.ip}: ${(error as Error).message}`);
    }
  }
}
