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

export class BroadlinkRM4ProBlasterPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly broadlinkClient: BroadlinkClient;

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
    const configuredAccessories = config.accessories ?? [];

    const activeUuids = new Set<string>();

    for (const accessoryConfig of configuredAccessories) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${accessoryConfig.name}`);
      activeUuids.add(uuid);

      const ip = accessoryConfig.ip ?? config.defaultIp;
      if (!ip) {
        this.log.warn(`Skipping accessory "${accessoryConfig.name}": no IP address configured (set "ip" or "defaultIp")`);
        continue;
      }

      const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

      if (existingAccessory) {
        existingAccessory.context.accessoryConfig = accessoryConfig;
        this.api.updatePlatformAccessories([existingAccessory]);
        new BasicAccessory(this, existingAccessory, accessoryConfig, ip);
      } else {
        this.log.info(`Adding accessory: ${accessoryConfig.name}`);
        const accessory = new this.api.platformAccessory(accessoryConfig.name, uuid);
        accessory.context.accessoryConfig = accessoryConfig;
        new BasicAccessory(this, accessory, accessoryConfig, ip);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
      }
    }

    const staleAccessories = this.accessories.filter((accessory) => !activeUuids.has(accessory.UUID));
    if (staleAccessories.length > 0) {
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
}
