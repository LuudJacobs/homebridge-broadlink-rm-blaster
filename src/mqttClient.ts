import mqtt, { MqttClient } from 'mqtt';
import type { Logger } from 'homebridge';

import { DEFAULT_LAST_SEEN_FORMAT, formatLastSeen } from './mqttLastSeen';
import type { LastSeenFormat } from './mqttLastSeen';

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
    username?: string,
    password?: string,
    private readonly defaultLastSeenFormat: LastSeenFormat = DEFAULT_LAST_SEEN_FORMAT,
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
  private deviceTopic(deviceTopic: string): string {
    return `${this.baseTopic}/${deviceTopic.replace(/^\/+|\/+$/g, '')}`;
  }

  // Commands arrive on <topic>/set, leaving <topic> itself free to carry
  // the accessory's state - so a controller can watch one and drive the
  // other without hearing its own commands back.
  subscribeToCommands(topic: string, handler: (payload: string) => void): boolean {
    if (!this.client) {
      return false;
    }
    const commandTopic = `${this.deviceTopic(topic)}/set`;
    this.handlers.set(commandTopic, handler);
    this.subscribeToTopic(commandTopic);
    this.log.info(`Listening for MQTT commands on ${commandTopic}`);
    return true;
  }

  // `body` is the accessory's own state (see buildStatePayload in
  // mqttLink.ts); last_seen is stamped on here, after the caller has already
  // decided whether the state actually changed.
  publishState(topic: string, body: Record<string, unknown>, retain: boolean): void {
    if (!this.client) {
      return;
    }
    const stateTopic = this.deviceTopic(topic);
    const payload = this.withLastSeen(body, this.defaultLastSeenFormat);
    this.client.publish(stateTopic, JSON.stringify(payload), { retain }, (error) => {
      if (error) {
        this.log.warn(`Failed to publish MQTT state to ${stateTopic}: ${error.message}`);
      }
    });
  }

  // Every publish - sensor readings and accessory state alike - can carry a
  // last_seen field, same idea as zigbee2mqtt. Accessory state always uses
  // the platform-wide default; a reading can override it per RM device.
  private withLastSeen(body: Record<string, unknown>, format: LastSeenFormat): Record<string, unknown> {
    const lastSeen = formatLastSeen(format, new Date());
    return lastSeen === undefined ? body : { ...body, last_seen: lastSeen };
  }

  private subscribeToTopic(topic: string): void {
    this.client?.subscribe(topic, (error) => {
      if (error) {
        this.log.warn(`Failed to subscribe to MQTT topic ${topic}: ${error.message}`);
      }
    });
  }

  publishReading(
    deviceName: string,
    temperature: number,
    humidity: number,
    retain: boolean,
    lastSeenFormat?: LastSeenFormat,
  ): void {
    if (!this.client) {
      return;
    }

    const topic = buildTopic(this.baseTopic, deviceName);
    const payload = this.withLastSeen({ temperature, humidity }, lastSeenFormat ?? this.defaultLastSeenFormat);
    this.client.publish(topic, JSON.stringify(payload), { retain }, (error) => {
      if (error) {
        this.log.warn(`Failed to publish MQTT reading: ${error.message}`);
      }
    });
  }
}
