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
import { TvAccessory } from './accessories/tvAccessory';
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

    this.publishTvAccessories(config);

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
      const ip = tvConfig.ip ?? config.defaultIp;
      if (!ip) {
        this.log.warn(`Skipping TV "${tvConfig.name}": no IP address configured (set "ip" or "defaultIp")`);
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
