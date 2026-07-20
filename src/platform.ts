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
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { BlasterPlatformConfig } from './configTypes';
import { BasicAccessory } from './accessories/basicAccessory';
import { DimmerAccessory } from './accessories/dimmerAccessory';
import { TemperatureHumiditySensorAccessory } from './accessories/temperatureHumiditySensorAccessory';

export class BroadlinkRMBlasterPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly broadlinkClient: BroadlinkClient;

  private readonly activeUuids = new Set<string>();

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.broadlinkClient = new BroadlinkClient(this.log);

    this.api.on('didFinishLaunching', () => {
      this.discoverAccessories();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.accessories.push(accessory);
  }

  private discoverAccessories(): void {
    const config = this.config as BlasterPlatformConfig;
    this.activeUuids.clear();

    for (const accessoryConfig of config.accessories ?? []) {
      const ip = accessoryConfig.ip ?? config.defaultIp;
      if (!ip) {
        this.log.warn(`Skipping accessory "${accessoryConfig.name}": no IP address configured (set "ip" or "defaultIp")`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${accessoryConfig.name}`);
      this.upsertAccessory(uuid, accessoryConfig.name, (accessory) => {
        accessory.context.accessoryConfig = accessoryConfig;
        new BasicAccessory(this, accessory, accessoryConfig, ip);
      });
    }

    for (const dimmerConfig of config.dimmers ?? []) {
      const ip = dimmerConfig.ip ?? config.defaultIp;
      if (!ip) {
        this.log.warn(`Skipping dimmer "${dimmerConfig.name}": no IP address configured (set "ip" or "defaultIp")`);
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

    if (config.showTemperatureHumidity !== false) {
      const ip = config.temperatureSensorIp ?? config.defaultIp;
      if (!ip) {
        this.log.warn('Skipping temperature/humidity sensor: no IP address configured (set "temperatureSensorIp" or "defaultIp")');
      } else {
        const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:sensor`);
        this.upsertAccessory(uuid, 'RM Sensor', (accessory) => {
          new TemperatureHumiditySensorAccessory(this, accessory, ip);
        });
      }
    }

    this.pruneStaleAccessories();
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
