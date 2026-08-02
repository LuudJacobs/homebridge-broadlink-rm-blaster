import mqtt, { MqttClient } from 'mqtt';
import type { Logger } from 'homebridge';

export const DEFAULT_MQTT_BASE_TOPIC = 'broadlinkrm';

export function buildTopic(baseTopic: string, deviceName: string): string {
  const slug = deviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${baseTopic}/${slug}`;
}

// Publishes sensor readings to MQTT so other plugins (e.g. homebridge-mqttthing)
// can subscribe to them independently of HomeKit. Mirrors NtfyNotifier: a total
// no-op unless enabled with a host/port, and never lets a connection/publish
// failure crash or affect the rest of the plugin.
export class MqttPublisher {
  private client?: MqttClient;
  private loggedConnectionError = false;

  constructor(
    private readonly log: Logger,
    enabled: boolean,
    host: string | undefined,
    port: number | undefined,
    private readonly baseTopic: string,
    username?: string,
    password?: string,
  ) {
    if (!enabled || !host || !port) {
      return;
    }

    this.client = mqtt.connect(`mqtt://${host}:${port}`, { username, password });
    this.client.on('error', (error) => {
      if (!this.loggedConnectionError) {
        this.log.warn(`MQTT connection error: ${error.message}`);
        this.loggedConnectionError = true;
      }
    });
    this.client.on('connect', () => {
      this.loggedConnectionError = false;
    });
  }

  publishReading(deviceName: string, temperature: number, humidity: number): void {
    if (!this.client) {
      return;
    }

    const topic = buildTopic(this.baseTopic, deviceName);
    this.client.publish(topic, JSON.stringify({ temperature, humidity }), { retain: true }, (error) => {
      if (error) {
        this.log.warn(`Failed to publish MQTT reading: ${error.message}`);
      }
    });
  }
}
