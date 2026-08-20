import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import { MqttLink } from '../mqttLink';
import type { TvAccessoryConfig } from '../configTypes';
import { powerSignalName, selectPowerCode } from './basicAccessory';
import { SwitchCooldown } from '../switchCooldown';

const DEFAULT_SWITCH_COOLDOWN_SECONDS = 1;

// Long enough that HomeKit's own optimistic UI doesn't ignore the update
// that snaps a refused switch back to its real state.
const REJECT_RESET_DELAY_MS = 1000;

export interface RemoteKeyResolution {
  signalName: string;
  code?: string;
}

// HAP's RemoteKey characteristic values (hap-nodejs CharacteristicDefinitions) -
// only the ones the todo asks for are mapped; REWIND/FAST_FORWARD/NEXT_TRACK/
// PREVIOUS_TRACK/PLAY_PAUSE (0-3, 11) have no configured signal and fall
// through to the default case.
const ARROW_UP = 4;
const ARROW_DOWN = 5;
const ARROW_LEFT = 6;
const ARROW_RIGHT = 7;
const SELECT = 8;
const BACK = 9;
const EXIT = 10;
const INFORMATION = 15;

export function resolveRemoteKeyCode(config: TvAccessoryConfig, remoteKey: number): RemoteKeyResolution | undefined {
  switch (remoteKey) {
    case ARROW_UP: return { signalName: 'Arrow Up', code: config.arrowUpCode };
    case ARROW_DOWN: return { signalName: 'Arrow Down', code: config.arrowDownCode };
    case ARROW_LEFT: return { signalName: 'Arrow Left', code: config.arrowLeftCode };
    case ARROW_RIGHT: return { signalName: 'Arrow Right', code: config.arrowRightCode };
    case SELECT: return { signalName: 'Select', code: config.selectCode };
    case BACK: return { signalName: 'Back', code: config.backCode };
    case EXIT: return { signalName: 'Exit', code: config.exitCode };
    case INFORMATION: return { signalName: 'Info', code: config.infoCode };
    default: return undefined;
  }
}

const PLACEHOLDER_INPUT_IDENTIFIER = 1;

export class TvAccessory {
  private readonly mqtt: MqttLink;
  private readonly cooldown: SwitchCooldown;
  private readonly tvService: Service;

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: TvAccessoryConfig,
    private readonly ip: string,
  ) {
    accessory.category = this.platform.api.hap.Categories.TELEVISION;
    this.cooldown = new SwitchCooldown((this.config.switchCooldownSeconds ?? DEFAULT_SWITCH_COOLDOWN_SECONDS) * 1000);

    const tvService = this.accessory.getService(this.platform.Service.Television)
      ?? this.accessory.addService(this.platform.Service.Television);
    this.tvService = tvService;
    tvService.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.config.name);
    tvService.setCharacteristic(this.platform.Characteristic.Name, this.config.name);
    tvService.setCharacteristic(
      this.platform.Characteristic.SleepDiscoveryMode,
      this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );
    tvService.setPrimaryService(true);

    tvService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setActiveFromHomeKit(value));

    this.mqtt = new MqttLink(this.platform, this.config.name, this.config, (command) => {
      if (command.state === undefined) {
        return;
      }
      return this.cooldown.applyWhenReady(
        Date.now(),
        command.state === 'on',
        (on) => this.applySetActive(on),
        undefined,
        (error) => this.platform.log.error(`Failed to apply a deferred MQTT On/Off to "${this.config.name}": ${(error as Error).message}`),
      );
    });

    // We don't have real inputs (channels/apps) to switch between - this
    // characteristic and the placeholder InputSource below only exist
    // because HomeKit requires both for a Television service to register
    // and display as a usable remote at all.
    tvService.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onGet(() => PLACEHOLDER_INPUT_IDENTIFIER)
      .onSet(() => {});

    tvService.getCharacteristic(this.platform.Characteristic.RemoteKey)
      .onSet((value) => this.handleRemoteKey(value));

    const inputService = this.accessory.getService(this.platform.Service.InputSource)
      ?? this.accessory.addService(this.platform.Service.InputSource);
    inputService.setCharacteristic(this.platform.Characteristic.Identifier, PLACEHOLDER_INPUT_IDENTIFIER);
    inputService.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.config.name);
    inputService.setCharacteristic(this.platform.Characteristic.Name, this.config.name);
    inputService.setCharacteristic(
      this.platform.Characteristic.IsConfigured,
      this.platform.Characteristic.IsConfigured.CONFIGURED,
    );
    inputService.setCharacteristic(
      this.platform.Characteristic.InputSourceType,
      this.platform.Characteristic.InputSourceType.OTHER,
    );
    inputService.setCharacteristic(
      this.platform.Characteristic.CurrentVisibilityState,
      this.platform.Characteristic.CurrentVisibilityState.SHOWN,
    );
    tvService.addLinkedService(inputService);

    const speakerService = this.accessory.getService(this.platform.Service.TelevisionSpeaker)
      ?? this.accessory.addService(this.platform.Service.TelevisionSpeaker);
    speakerService.setCharacteristic(
      this.platform.Characteristic.VolumeControlType,
      this.platform.Characteristic.VolumeControlType.RELATIVE,
    );
    speakerService.getCharacteristic(this.platform.Characteristic.Mute)
      .onGet(() => this.getMuted())
      .onSet((value) => this.setMute(value));
    speakerService.getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet((value) => this.handleVolumeSelector(value));
    tvService.addLinkedService(speakerService);
  }

  // Same assumed-state approach as the other accessories: a blaster has no
  // feedback, so Active/Mute are whatever we last set them to.
  private getActive(): CharacteristicValue {
    return this.accessory.context.active
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private getMuted(): CharacteristicValue {
    return Boolean(this.accessory.context.muted);
  }

  // A signal within the minimum switch interval is refused - the tile
  // snaps back to its real (unchanged) state shortly after, same
  // "HomeKit's optimistic UI needs a real delay" lesson as every other
  // auto-resetting switch in this codebase - but it isn't just dropped:
  // the first refused signal in a window is still held and applied once
  // the window clears (see SwitchCooldown.applyWhenReady). A same-state
  // request is a pure no-op and never touches the cooldown at all.
  private setActiveFromHomeKit(value: CharacteristicValue): void | Promise<void> {
    const on = value === this.platform.Characteristic.Active.ACTIVE;
    if (on === Boolean(this.accessory.context.active)) {
      return;
    }
    return this.cooldown.applyWhenReady(
      Date.now(),
      on,
      (v) => this.applySetActive(v),
      () => {
        this.platform.log.warn(`Deferring ${on ? 'On' : 'Off'} for "${this.config.name}" - within the minimum switch interval.`);
        setTimeout(
          () => this.tvService.updateCharacteristic(this.platform.Characteristic.Active, this.getActive()),
          REJECT_RESET_DELAY_MS,
        );
      },
      (error) => this.platform.log.error(`Failed to apply a deferred On/Off to "${this.config.name}": ${(error as Error).message}`),
    );
  }

  private async applySetActive(on: boolean): Promise<void> {
    const code = selectPowerCode(this.config, on);
    await this.send(code, powerSignalName(this.config, on));
    this.accessory.context.active = on;
    this.mqtt.publishState(on);
    this.tvService.updateCharacteristic(this.platform.Characteristic.Active, this.getActive());
  }

  private async handleRemoteKey(value: CharacteristicValue): Promise<void> {
    const resolved = resolveRemoteKeyCode(this.config, Number(value));
    if (!resolved) {
      return;
    }
    if (!resolved.code) {
      this.platform.log.warn(`No ${resolved.signalName} signal configured for "${this.config.name}"`);
      return;
    }
    await this.send(resolved.code, resolved.signalName);
  }

  private async setMute(value: CharacteristicValue): Promise<void> {
    if (!this.config.muteCode) {
      this.platform.log.warn(`No Mute signal configured for "${this.config.name}"`);
      return;
    }
    // A remote's mute button is a single toggle signal, not distinct
    // on/off signals, so the same code is sent regardless of direction.
    await this.send(this.config.muteCode, 'Mute');
    this.accessory.context.muted = Boolean(value);
  }

  private async handleVolumeSelector(value: CharacteristicValue): Promise<void> {
    const increment = value === this.platform.Characteristic.VolumeSelector.INCREMENT;
    const signalName = increment ? 'Volume Up' : 'Volume Down';
    const code = increment ? this.config.volumeUpCode : this.config.volumeDownCode;
    if (!code) {
      this.platform.log.warn(`No ${signalName} signal configured for "${this.config.name}"`);
      return;
    }
    await this.send(code, signalName);
  }

  private async send(code: string, signalName: string): Promise<void> {
    try {
      await this.platform.broadlinkClient.sendCode(this.ip, code);
      this.platform.log.info(`Sent ${signalName} to ${this.config.name}`);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
