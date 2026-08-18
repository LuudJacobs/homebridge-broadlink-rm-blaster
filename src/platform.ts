import * as fs from 'fs';

import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { BroadlinkClient } from './broadlinkClient';
import { NtfyNotifier } from './ntfyNotifier';
import { DEFAULT_MQTT_BASE_TOPIC, MqttBridge } from './mqttClient';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { BlasterPlatformConfig } from './configTypes';
import { backupConfig, findPlatformBlock, stripBlankEntries, writeConfigAtomically } from './configFile';
import type { HomebridgeConfigFile } from './configFile';
import { BasicAccessory } from './accessories/basicAccessory';
import { AdvancedAccessory } from './accessories/advancedAccessory';
import { DimmerAccessory } from './accessories/dimmerAccessory';
import { FanAccessory } from './accessories/fanAccessory';
import { TvAccessory } from './accessories/tvAccessory';
import { TemperatureHumiditySensorAccessory } from './accessories/temperatureHumiditySensorAccessory';

export class BroadlinkRMBlasterPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly broadlinkClient: BroadlinkClient;
  public readonly notifier: NtfyNotifier;
  public readonly mqtt: MqttBridge;

  private readonly activeUuids = new Set<string>();

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    const blasterConfig = config as BlasterPlatformConfig;
    const deviceNames = new Map<string, string>();
    for (const rmDevice of blasterConfig.rmDevices ?? []) {
      deviceNames.set(rmDevice.ip, rmDevice.name);
    }
    this.notifier = new NtfyNotifier(this.log, blasterConfig.ntfyTopic, deviceNames);
    this.mqtt = new MqttBridge(
      this.log,
      !!blasterConfig.enableMqtt,
      blasterConfig.mqttHost,
      blasterConfig.mqttPort,
      blasterConfig.mqttBaseTopic ?? DEFAULT_MQTT_BASE_TOPIC,
      blasterConfig.mqttUsername,
      blasterConfig.mqttPassword,
      blasterConfig.mqttLastSeenFormat,
    );
    this.broadlinkClient = new BroadlinkClient(this.log, this.notifier);

    this.api.on('didFinishLaunching', () => {
      this.discoverAccessories();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  // Saving the Config UI form can leave a blank row behind in any of the
  // accessory arrays. That is the form's doing rather than a mistake worth
  // shouting about, so skip anything with no name and say so only in debug.
  private isBlankEntry(name: string | undefined, kind: string): boolean {
    if (name && name.trim()) {
      return false;
    }
    this.log.debug(`Ignoring an empty ${kind} entry - remove the blank row from your config.`);
    return true;
  }

  // The Config UI X form can leave a blank row behind in config.json on
  // save (see isBlankEntry above) - existing loads already skip those, but
  // nothing made them go away from the file itself, so they pile up across
  // saves. Rewrite the file to drop them, once, only when there is actually
  // something to drop.
  private cleanUpConfigFile(): void {
    try {
      const configPath = this.api.user.configPath();
      const fileConfig: HomebridgeConfigFile = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const platformBlock = findPlatformBlock(fileConfig);
      if (!platformBlock) {
        return;
      }
      const { config: cleaned, removed } = stripBlankEntries(platformBlock);
      if (removed.length === 0) {
        return;
      }
      backupConfig(configPath);
      Object.assign(platformBlock, cleaned);
      writeConfigAtomically(configPath, fileConfig);
      this.log.info(`Cleaned up config.json: removed ${removed.join(', ')}. Backed up to config.json.backup.`);
    } catch (error) {
      this.log.warn(`Could not clean up blank config entries: ${(error as Error).message}`);
    }
  }

  private discoverAccessories(): void {
    this.cleanUpConfigFile();

    const config = this.config as BlasterPlatformConfig;
    this.activeUuids.clear();

    for (const accessoryConfig of config.accessories ?? []) {
      if (this.isBlankEntry(accessoryConfig?.name, 'accessory')) {
        continue;
      }
      const ip = this.resolveRmDeviceIp(config, accessoryConfig.rmDevice);
      if (!ip) {
        this.log.warn(
          `Skipping accessory "${accessoryConfig.name}": no RM device named "${accessoryConfig.rmDevice}" configured`,
        );
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${accessoryConfig.name}`);
      this.upsertAccessory(uuid, accessoryConfig.name, (accessory) => {
        accessory.context.accessoryConfig = accessoryConfig;
        new BasicAccessory(this, accessory, accessoryConfig, ip);
      });
    }

    for (const advancedConfig of config.advancedAccessories ?? []) {
      if (this.isBlankEntry(advancedConfig?.name, 'advanced accessory')) {
        continue;
      }
      const ip = this.resolveRmDeviceIp(config, advancedConfig.rmDevice);
      if (!ip) {
        this.log.warn(
          `Skipping advanced accessory "${advancedConfig.name}": no RM device named "${advancedConfig.rmDevice}" configured`,
        );
        continue;
      }
      if (advancedConfig.signals.length === 0) {
        this.log.warn(`Skipping advanced accessory "${advancedConfig.name}": no signals configured`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:advanced:${advancedConfig.name}`);
      this.upsertAccessory(uuid, advancedConfig.name, (accessory) => {
        accessory.context.advancedConfig = advancedConfig;
        new AdvancedAccessory(this, accessory, advancedConfig, ip);
      });
    }

    for (const fanConfig of config.fans ?? []) {
      if (this.isBlankEntry(fanConfig?.name, 'fan')) {
        continue;
      }
      const ip = this.resolveRmDeviceIp(config, fanConfig.rmDevice);
      if (!ip) {
        this.log.warn(`Skipping fan "${fanConfig.name}": no RM device named "${fanConfig.rmDevice}" configured`);
        continue;
      }
      // A single-speed fan has no speed control at all, so only a fan with
      // nothing to drive it whatsoever is worth skipping.
      const hasAnyControl = !!fanConfig.speedUpCode || !!fanConfig.swingCode
        || !!fanConfig.powerToggleCode || !!fanConfig.powerOnCode || !!fanConfig.powerOffCode
        || (fanConfig.modes ?? []).length > 0;
      if (!hasAnyControl) {
        this.log.warn(`Skipping fan "${fanConfig.name}": nothing configured to control it`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:fan:${fanConfig.name}`);
      this.upsertAccessory(uuid, fanConfig.name, (accessory) => {
        accessory.context.fanConfig = fanConfig;
        new FanAccessory(this, accessory, fanConfig, ip);
      });
    }

    for (const dimmerConfig of config.dimmers ?? []) {
      if (this.isBlankEntry(dimmerConfig?.name, 'dimmer')) {
        continue;
      }
      const ip = this.resolveRmDeviceIp(config, dimmerConfig.rmDevice);
      if (!ip) {
        this.log.warn(`Skipping dimmer "${dimmerConfig.name}": no RM device named "${dimmerConfig.rmDevice}" configured`);
        continue;
      }
      if (dimmerConfig.levels.length === 0) {
        this.log.warn(`Skipping dimmer "${dimmerConfig.name}": no brightness levels configured`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:dimmer:${dimmerConfig.name}`);
      this.upsertAccessory(uuid, dimmerConfig.name, (accessory) => {
        accessory.context.dimmerConfig = dimmerConfig;
        new DimmerAccessory(this, accessory, dimmerConfig, ip);
      });
    }

    this.publishTvAccessories(config);

    for (const rmDevice of config.rmDevices ?? []) {
      if (this.isBlankEntry(rmDevice?.name, 'RM device')) {
        continue;
      }
      const showInHomeKit = !!rmDevice.enableTemperatureHumidity;
      const publishToMqtt = !!rmDevice.enableMqttPublish;
      if (!showInHomeKit && !publishToMqtt) {
        continue;
      }

      if (showInHomeKit) {
        const sensorName = `${rmDevice.name} Sensor`;
        const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:sensor:${rmDevice.name}`);
        this.upsertAccessory(uuid, sensorName, (accessory) => {
          new TemperatureHumiditySensorAccessory(
            this, accessory, rmDevice.ip, sensorName, rmDevice.name, publishToMqtt, rmDevice.mqttRetain !== false,
            rmDevice.mqttLastSeenFormat,
          );
        });
      } else {
        // MQTT-only: no HomeKit accessory needed, just poll and publish.
        new TemperatureHumiditySensorAccessory(
          this, undefined, rmDevice.ip, rmDevice.name, rmDevice.name, publishToMqtt, rmDevice.mqttRetain !== false,
          rmDevice.mqttLastSeenFormat,
        );
      }
    }

    this.pruneStaleAccessories();
  }

  // Every accessory now references its RM by name (rmDevice) instead of an
  // optional ip/"use the default" override, since there's no longer a single
  // default device once multiple RM devices are configured.
  private resolveRmDeviceIp(config: BlasterPlatformConfig, rmDeviceName: string): string | undefined {
    return config.rmDevices?.find((device) => device.name === rmDeviceName)?.ip;
  }

  // TVs can't go through upsertAccessory's normal bridged path: HomeKit only
  // renders a proper TV tile/remote for a Television service when it's
  // published as its own external accessory (a bridged Television service
  // shows up as a generic "unsupported device"). External accessories aren't
  // cached/restored via configureAccessory() the way bridged ones are, so a
  // fresh PlatformAccessory has to be built and republished on every
  // didFinishLaunching - the stable UUID is what keeps the same HomeKit
  // pairing across restarts, not any caching on our end. Each TV also needs
  // to be added to the Home app separately, using the setup code Homebridge
  // logs for it - it won't just appear alongside the bridged accessories.
  private publishTvAccessories(config: BlasterPlatformConfig): void {
    const externalAccessories: PlatformAccessory[] = [];

    for (const tvConfig of config.tvs ?? []) {
      if (this.isBlankEntry(tvConfig?.name, 'TV')) {
        continue;
      }
      const ip = this.resolveRmDeviceIp(config, tvConfig.rmDevice);
      if (!ip) {
        this.log.warn(`Skipping TV "${tvConfig.name}": no RM device named "${tvConfig.rmDevice}" configured`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:tv:${tvConfig.name}`);
      const accessory = new this.api.platformAccessory(tvConfig.name, uuid);
      accessory.context.tvConfig = tvConfig;
      // Fully configures every service/characteristic (including
      // accessory.category) - must happen before publishing below, since
      // HomeKit mishandles services added to an already-published accessory.
      new TvAccessory(this, accessory, tvConfig, ip);
      externalAccessories.push(accessory);
    }

    if (externalAccessories.length > 0) {
      this.log.info(
        `Publishing ${externalAccessories.length} TV(s) as external accessories - ` +
        'add each one manually in the Home app using the setup code logged for it below.',
      );
      this.api.publishExternalAccessories(PLUGIN_NAME, externalAccessories);
    }
  }

  private upsertAccessory(uuid: string, name: string, setup: (accessory: PlatformAccessory) => void): void {
    this.activeUuids.add(uuid);

    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      setup(existingAccessory);
      this.api.updatePlatformAccessories([existingAccessory]);
    } else {
      this.log.info(`Adding accessory: ${name}`);
      const accessory = new this.api.platformAccessory(name, uuid);
      setup(accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    }
  }

  private pruneStaleAccessories(): void {
    const staleAccessories = this.accessories.filter((accessory) => !this.activeUuids.has(accessory.UUID));
    if (staleAccessories.length === 0) {
      return;
    }

    for (const accessory of staleAccessories) {
      this.log.info(`Removing stale accessory: ${accessory.displayName}`);
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories);
    for (const accessory of staleAccessories) {
      const index = this.accessories.indexOf(accessory);
      if (index !== -1) {
        this.accessories.splice(index, 1);
      }
    }
  }
}
