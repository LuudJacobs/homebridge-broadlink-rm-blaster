import type { BroadlinkRMBlasterPlatform } from './platform';
import { parseMqttCommand } from './mqttCommand';
import type { MqttCommand } from './mqttCommand';

// The per-accessory MQTT config every type shares.
export interface MqttLinkConfig {
  mqttSubscribe?: boolean;
  mqttTopic?: string;
  mqttRetain?: boolean;
}

// What an accessory reports about itself. Everything but `on` is optional,
// since only some accessory types have it - a plain switch has nothing else
// to say, while a fan has a speed and a dimmer a level.
export interface MqttState {
  on: boolean;
  speedPercent?: number;
  levelPercent?: number;
  swing?: boolean;
}

// Deliberately the same keys and value shapes parseMqttCommand accepts, so
// what an accessory publishes can be fed straight back to it as a command.
export function buildStatePayload(state: MqttState): Record<string, unknown> {
  const payload: Record<string, unknown> = { state: state.on ? 'ON' : 'OFF' };
  if (state.speedPercent !== undefined) {
    payload.speed = Math.round(state.speedPercent);
  }
  if (state.levelPercent !== undefined) {
    payload.level = Math.round(state.levelPercent);
  }
  if (state.swing !== undefined) {
    payload.swing = state.swing ? 'ON' : 'OFF';
  }
  return payload;
}

// Ties one accessory to MQTT: listens for commands on <topic>/set and
// publishes its on/off state to <topic>. A no-op unless the accessory asked
// for it and MQTT itself is set up, so accessories can construct one
// unconditionally.
export class MqttLink {
  private readonly topic?: string;
  private readonly retain: boolean = true;
  private lastPublished?: string;

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly name: string,
    config: MqttLinkConfig,
    onCommand: (command: MqttCommand) => void | Promise<void>,
  ) {
    if (!config.mqttSubscribe) {
      return;
    }

    const topic = (config.mqttTopic ?? '').trim();
    if (!topic) {
      this.platform.log.warn(`"${name}" has MQTT control enabled but no topic - ignoring.`);
      return;
    }
    if (!this.platform.mqtt.enabled) {
      this.platform.log.warn(
        `"${name}" has MQTT control enabled, but MQTT itself isn't set up - fill in the MQTT settings first.`,
      );
      return;
    }

    this.topic = topic;
    this.retain = config.mqttRetain !== false;
    this.platform.mqtt.subscribeToCommands(topic, (payload) => {
      const command = parseMqttCommand(payload);
      if (!command) {
        this.platform.log.warn(`Ignoring an MQTT message for "${name}" that made no sense: ${payload}`);
        return;
      }
      // Driven by MQTT rather than HomeKit, so there is nobody to throw an
      // error back to - log it and carry on.
      void (async () => {
        try {
          await onCommand(command);
        } catch (error) {
          this.platform.log.error(`Failed to apply an MQTT command to "${name}": ${(error as Error).message}`);
        }
      })();
    });
  }

  // Takes a bare boolean for the accessory types that only have on/off to
  // report, or the full state for the ones that carry more.
  //
  // Several things can change in one go - a fan resyncs every characteristic
  // after any action - so only say something when the answer actually
  // changed, rather than repeating it to the broker. The comparison is on
  // the payload itself, so a speed or level change is a change; last_seen is
  // added further down in MqttBridge, after this, so it can't defeat the
  // check by differing every time.
  publishState(state: boolean | MqttState): void {
    if (!this.topic) {
      return;
    }
    const payload = buildStatePayload(typeof state === 'boolean' ? { on: state } : state);
    const serialized = JSON.stringify(payload);
    if (serialized === this.lastPublished) {
      return;
    }
    this.lastPublished = serialized;
    this.platform.mqtt.publishState(this.topic, payload, this.retain);
  }
}
