import mqtt, { MqttClient } from 'mqtt';
import type { Logger } from 'homebridge';

export const DEFAULT_MQTT_BASE_TOPIC = 'broadlinkrm';

export function buildTopic(baseTopic: string, deviceName: string): string {
  const slug = deviceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${baseTopic}/${slug}`;
}

// The plugin's one MQTT connection: publishes sensor readings so other
// plugins (e.g. homebridge-mqttthing) can read them independently of
// HomeKit, and subscribes to per-accessory topics so a message can drive a
// device. Mirrors NtfyNotifier: a total no-op unless enabled with a
// host/port, and never lets a connection failure affect anything else.
export class MqttBridge {
  private client?: MqttClient;
  private loggedConnectionError = false;
  private readonly handlers = new Map<string, (payload: string) => void>();

  constructor(
    private readonly log: Logger,
    enabled: boolean,
    host: string | undefined,
    port: number | undefined,
    private readonly baseTopic: string,
    private readonly retain: boolean,
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
      // Re-subscribe after a reconnect, otherwise a dropped connection
      // silently stops delivering commands.
      for (const topic of this.handlers.keys()) {
        this.subscribeToTopic(topic);
      }
    });
    this.client.on('message', (topic, payload) => {
      const handler = this.handlers.get(topic);
      if (handler) {
        handler(payload.toString());
      }
    });
  }

  get enabled(): boolean {
    return !!this.client;
  }

  // `deviceTopic` is just the accessory's own part; the base topic is
  // whatever the MQTT settings already define, so moving it moves
  // everything at once.
  subscribeToDevice(deviceTopic: string, handler: (payload: string) => void): boolean {
    if (!this.client) {
      return false;
    }
    const topic = `${this.baseTopic}/${deviceTopic.replace(/^\/+|\/+$/g, '')}`;
    this.handlers.set(topic, handler);
    this.subscribeToTopic(topic);
    this.log.info(`Listening for MQTT commands on ${topic}`);
    return true;
  }

  private subscribeToTopic(topic: string): void {
    this.client?.subscribe(topic, (error) => {
      if (error) {
        this.log.warn(`Failed to subscribe to MQTT topic ${topic}: ${error.message}`);
      }
    });
  }

  publishReading(deviceName: string, temperature: number, humidity: number): void {
    if (!this.client) {
      return;
    }

    const topic = buildTopic(this.baseTopic, deviceName);
    this.client.publish(topic, JSON.stringify({ temperature, humidity }), { retain: this.retain }, (error) => {
      if (error) {
        this.log.warn(`Failed to publish MQTT reading: ${error.message}`);
      }
    });
  }
}
