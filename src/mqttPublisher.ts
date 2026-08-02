import mqtt, { MqttClient } from 'mqtt';
import type { Logger } from 'homebridge';

export const DEFAULT_MQTT_TOPIC = 'homebridge-broadlink-rm-blaster';

export function buildTopic(prefix: string, deviceName: string): string {
  const slug = deviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${prefix}/${slug}`;
}

// Publishes sensor readings to MQTT so other plugins (e.g. homebridge-mqttthing)
// can subscribe to them independently of HomeKit. Mirrors NtfyNotifier: a total
// no-op unless a broker URL is configured, and never lets a connection/publish
// failure crash or affect the rest of the plugin.
export class MqttPublisher {
  private client?: MqttClient;
  private loggedConnectionError = false;

  constructor(
    private readonly log: Logger,
    brokerUrl: string | undefined,
    private readonly topicPrefix: string,
    username?: string,
    password?: string,
  ) {
    if (!brokerUrl) {
      return;
    }

    this.client = mqtt.connect(brokerUrl, { username, password });
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

    const topic = buildTopic(this.topicPrefix, deviceName);
    this.client.publish(topic, JSON.stringify({ temperature, humidity }), { retain: true }, (error) => {
      if (error) {
        this.log.warn(`Failed to publish MQTT reading: ${error.message}`);
      }
    });
  }
}
