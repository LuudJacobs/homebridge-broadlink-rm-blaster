import type { BroadlinkRMBlasterPlatform } from './platform';
import { parseMqttCommand } from './mqttCommand';
import type { MqttCommand } from './mqttCommand';

// The per-accessory MQTT config every type shares.
export interface MqttLinkConfig {
  mqttSubscribe?: boolean;
  mqttTopic?: string;
}

// Ties one accessory to MQTT: listens for commands on <topic>/set and
// publishes its on/off state to <topic>. A no-op unless the accessory asked
// for it and MQTT itself is set up, so accessories can construct one
// unconditionally.
export class MqttLink {
  private readonly topic?: string;
  private lastPublished?: boolean;

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

  // Several things can change in one go - a fan resyncs every
  // characteristic after any action - so only say something when the
  // answer actually changed, rather than repeating it to the broker.
  publishState(on: boolean): void {
    if (!this.topic || on === this.lastPublished) {
      return;
    }
    this.lastPublished = on;
    this.platform.mqtt.publishState(this.topic, on);
  }
}
