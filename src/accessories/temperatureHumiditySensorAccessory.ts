import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';

const POLL_INTERVAL_MS = 60_000;

// A single poll failure is normal RF/network noise. Only treat the sensor as
// actually unreachable (clear the cached reading, notify) after this many in
// a row - avoids flapping to "No Response" and a notification on one blip.
const MAX_CONSECUTIVE_FAILURES = 5;

export class TemperatureHumiditySensorAccessory {
  private consecutiveFailures = 0;

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory | undefined,
    private readonly ip: string,
    private readonly name: string,
    private readonly deviceName: string,
    private readonly publishToMqtt: boolean,
    private readonly retain: boolean,
  ) {
    if (this.accessory) {
      const temperatureService = this.accessory.getService(this.platform.Service.TemperatureSensor)
        ?? this.accessory.addService(this.platform.Service.TemperatureSensor);
      temperatureService.setCharacteristic(this.platform.Characteristic.Name, this.name);
      temperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(() => this.getTemperature());

      const humidityService = this.accessory.getService(this.platform.Service.HumiditySensor)
        ?? this.accessory.addService(this.platform.Service.HumiditySensor);
      humidityService.setCharacteristic(this.platform.Characteristic.Name, this.name);
      humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
        .onGet(() => this.getHumidity());
    }

    // Not all RM units actually report real sensor data ("if available" in
    // the todo) - an immediate poll plus a recurring one lets a supported unit
    // start reporting quickly, while an unsupported one just keeps failing
    // quietly and onGet honestly reports "no response" rather than a fake 0.
    this.poll();
    setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private getTemperature(): CharacteristicValue {
    const temperature = this.accessory?.context.temperature;
    if (temperature === undefined) {
      this.throwNoResponse();
    }
    return temperature;
  }

  private getHumidity(): CharacteristicValue {
    const humidity = this.accessory?.context.humidity;
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

      this.consecutiveFailures = 0;
      this.platform.notifier.notifyConnectionRecovered(this.ip);

      if (this.accessory) {
        this.accessory.context.temperature = temperature;
        this.accessory.context.humidity = humidity;

        this.accessory.getService(this.platform.Service.TemperatureSensor)
          ?.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temperature);
        this.accessory.getService(this.platform.Service.HumiditySensor)
          ?.updateCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity, humidity);
      }

      if (this.publishToMqtt) {
        this.platform.mqtt.publishReading(this.deviceName, temperature, humidity, this.retain);
      }
    } catch (error) {
      this.platform.log.warn(`Failed to read temperature/humidity from ${this.ip}: ${(error as Error).message}`);

      this.consecutiveFailures++;
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        if (this.accessory) {
          this.accessory.context.temperature = undefined;
          this.accessory.context.humidity = undefined;
        }
        this.platform.notifier.notifyConnectionFailure(
          this.ip,
          'Timed out reading temperature and humidity. Check Homebridge logs for more details.',
        );
      }
    }
  }
}
