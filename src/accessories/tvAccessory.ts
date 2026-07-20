import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { TvAccessoryConfig } from '../configTypes';
import { selectPowerCode } from './basicAccessory';

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
  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: TvAccessoryConfig,
    private readonly ip: string,
  ) {
    accessory.category = this.platform.api.hap.Categories.TELEVISION;

    const tvService = this.accessory.getService(this.platform.Service.Television)
      ?? this.accessory.addService(this.platform.Service.Television);
    tvService.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.config.name);
    tvService.setCharacteristic(this.platform.Characteristic.Name, this.config.name);
    tvService.setCharacteristic(
      this.platform.Characteristic.SleepDiscoveryMode,
      this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
    );
    tvService.setPrimaryService(true);

    tvService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.getActive())
      .onSet((value) => this.setActive(value));

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

  private async setActive(value: CharacteristicValue): Promise<void> {
    const on = value === this.platform.Characteristic.Active.ACTIVE;
    const code = selectPowerCode(this.config, on);
    await this.send(code, on ? 'Power On' : 'Power Off');
    this.accessory.context.active = on;
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
