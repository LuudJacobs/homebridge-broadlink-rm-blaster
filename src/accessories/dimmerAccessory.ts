import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { BroadlinkRM4ProBlasterPlatform } from '../platform';
import type { DimmerAccessoryConfig } from '../configTypes';

export interface ResolvedLevel {
  percent: number;
  code: string;
}

function candidateLevels(config: DimmerAccessoryConfig): ResolvedLevel[] {
  return [
    { percent: 0, code: config.zeroPercentCode },
    ...config.levels.map((level) => ({ percent: level.level, code: level.code })),
  ];
}

export function remapToPhysicalPercent(requestedPercent: number, config: DimmerAccessoryConfig): number {
  const maxPercent = (config.useMaxBrightnessLevel && config.maxBrightnessLevel !== undefined)
    ? config.maxBrightnessLevel
    : 100;
  return (requestedPercent * maxPercent) / 100;
}

export function findNearestLevel(config: DimmerAccessoryConfig, physicalPercent: number): ResolvedLevel {
  const candidates = candidateLevels(config);
  return candidates.reduce((closest, candidate) =>
    Math.abs(candidate.percent - physicalPercent) < Math.abs(closest.percent - physicalPercent) ? candidate : closest,
  );
}

// Translates a logical 0-100 request into a physical percent (via the
// configured max, if any) before matching it to a configured signal. Used for
// live slider requests and for the "default brightness" power-on tier below,
// since both are logical values on the same 0-100 scale.
export function resolveBrightnessCode(config: DimmerAccessoryConfig, requestedPercent: number): ResolvedLevel {
  return findNearestLevel(config, remapToPhysicalPercent(requestedPercent, config));
}

// Default brightness is a logical 0-100 target, same scale as a live slider
// request, so it goes through the same remap-then-nearest-match pipeline -
// otherwise a configured default could physically exceed the configured max,
// defeating the point of the cap. Max brightness itself is the ceiling, so it
// resolves directly rather than being remapped through itself.
export function resolvePowerOnLevel(config: DimmerAccessoryConfig, lastKnown?: ResolvedLevel): ResolvedLevel {
  if (config.useLastKnownBrightness && lastKnown) {
    return lastKnown;
  }

  if (config.useDefaultBrightnessLevel && config.defaultBrightnessLevel !== undefined) {
    const percent = config.defaultBrightnessLevel;
    return { percent, code: resolveBrightnessCode(config, percent).code };
  }

  if (config.useMaxBrightnessLevel && config.maxBrightnessLevel !== undefined) {
    const percent = config.maxBrightnessLevel;
    return { percent, code: findNearestLevel(config, percent).code };
  }

  const highest = config.levels.reduce((a, b) => (b.level > a.level ? b : a));
  return { percent: highest.level, code: highest.code };
}

export class DimmerAccessory {
  constructor(
    private readonly platform: BroadlinkRM4ProBlasterPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: DimmerAccessoryConfig,
    private readonly ip: string,
  ) {
    const service = this.accessory.getService(this.platform.Service.Lightbulb)
      ?? this.accessory.addService(this.platform.Service.Lightbulb);
    service.setCharacteristic(this.platform.Characteristic.Name, this.config.name);

    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.getOn())
      .onSet((value) => this.setOn(value));

    service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(() => this.getBrightness())
      .onSet((value) => this.setBrightness(value));
  }

  // Same assumed-state approach as BasicAccessory: a blaster has no feedback,
  // so on/brightness are whatever we last set them to, cached in context.
  private getOn(): CharacteristicValue {
    return Boolean(this.accessory.context.on);
  }

  private getBrightness(): CharacteristicValue {
    return Number(this.accessory.context.brightnessPercent ?? 0);
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);

    if (!on) {
      await this.send(this.config.powerOffCode ?? this.config.zeroPercentCode);
      this.accessory.context.on = false;
      return;
    }

    const lastKnown = this.accessory.context.lastKnownLevel as ResolvedLevel | undefined;
    const resolved = resolvePowerOnLevel(this.config, lastKnown);

    await this.send(this.config.powerOnCode ?? resolved.code);

    this.accessory.context.on = true;
    this.accessory.context.brightnessPercent = resolved.percent;
    this.accessory.context.lastKnownLevel = resolved;

    this.accessory.getService(this.platform.Service.Lightbulb)
      ?.updateCharacteristic(this.platform.Characteristic.Brightness, resolved.percent);
  }

  private async setBrightness(value: CharacteristicValue): Promise<void> {
    const requestedPercent = Number(value);
    const resolved = resolveBrightnessCode(this.config, requestedPercent);

    await this.send(resolved.code);

    this.accessory.context.on = true;
    this.accessory.context.brightnessPercent = requestedPercent;
    this.accessory.context.lastKnownLevel = resolved;
  }

  private async send(code: string): Promise<void> {
    try {
      await this.platform.broadlinkClient.sendCode(this.ip, code);
    } catch (error) {
      this.platform.log.error(`Failed to send code for "${this.config.name}": ${(error as Error).message}`);
      const { HapStatusError, HAPStatus } = this.platform.api.hap;
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
