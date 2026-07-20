import type { CharacteristicValue, PlatformAccessory } from 'homebridge';

import type { BroadlinkRMBlasterPlatform } from '../platform';
import type { DimmerAccessoryConfig } from '../configTypes';

export interface ResolvedLevel {
  percent: number;
  code: string;
}

const DEFAULT_DEBOUNCE_SECONDS = 0.5;

function candidateLevels(config: DimmerAccessoryConfig): ResolvedLevel[] {
  return [
    { percent: 0, code: config.zeroPercentCode },
    ...config.levels.map((level) => ({ percent: level.level, code: level.code })),
    { percent: 100, code: config.hundredPercentCode },
  ];
}

export function getEffectiveMaxPercent(config: DimmerAccessoryConfig): number {
  return (config.useMaxBrightnessLevel && config.maxBrightnessLevel !== undefined)
    ? config.maxBrightnessLevel
    : 100;
}

export function remapToPhysicalPercent(requestedPercent: number, config: DimmerAccessoryConfig): number {
  return (requestedPercent * getEffectiveMaxPercent(config)) / 100;
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

  // A guaranteed 100% candidate always exists (hundredPercentCode is
  // required), so "highest" is now definitionally the true 100% signal
  // rather than whatever happened to be the highest configured level.
  return { percent: 100, code: config.hundredPercentCode };
}

export class DimmerAccessory {
  private brightnessDebounceTimer?: NodeJS.Timeout;

  constructor(
    private readonly platform: BroadlinkRMBlasterPlatform,
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

  private clearBrightnessDebounce(): void {
    if (this.brightnessDebounceTimer) {
      clearTimeout(this.brightnessDebounceTimer);
      this.brightnessDebounceTimer = undefined;
    }
  }

  private async turnOff(): Promise<void> {
    this.clearBrightnessDebounce();
    await this.send(this.config.powerOffCode, 'Power Off');
    this.accessory.context.on = false;
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const on = Boolean(value);

    if (!on) {
      await this.turnOff();
      return;
    }

    this.clearBrightnessDebounce();

    const lastKnown = this.accessory.context.lastKnownLevel as ResolvedLevel | undefined;
    const resolved = resolvePowerOnLevel(this.config, lastKnown);

    // Power On only turns the light on - it doesn't carry a brightness level,
    // so the resolved level's own signal has to be sent separately for the
    // device to actually reach it, not just HomeKit's assumed display state.
    await this.send(this.config.powerOnCode, 'Power On');
    await this.send(resolved.code, `Brightness ${resolved.percent}%`);

    this.accessory.context.on = true;
    this.accessory.context.brightnessPercent = resolved.percent;
    this.accessory.context.lastKnownLevel = resolved;

    this.accessory.getService(this.platform.Service.Lightbulb)
      ?.updateCharacteristic(this.platform.Characteristic.Brightness, resolved.percent);
  }

  // Debounced: a slider drag in the Home app fires many rapid onSet calls, so
  // the actual send() is deferred until debounceSeconds of silence, reset on
  // every call. Display state (and "last known brightness") updates
  // immediately/optimistically so the slider itself tracks the drag smoothly
  // and doesn't lag behind while the send is pending.
  private setBrightness(value: CharacteristicValue): void {
    const requestedPercent = Number(value);
    const resolved = resolveBrightnessCode(this.config, requestedPercent);
    const effectiveMax = getEffectiveMaxPercent(this.config);

    this.accessory.context.on = true;
    this.accessory.context.brightnessPercent = requestedPercent;
    this.accessory.context.lastKnownLevel = resolved;

    this.clearBrightnessDebounce();
    const debounceMs = (this.config.debounceSeconds ?? DEFAULT_DEBOUNCE_SECONDS) * 1000;
    this.brightnessDebounceTimer = setTimeout(() => {
      this.brightnessDebounceTimer = undefined;
      this.send(resolved.code, `Brightness ${resolved.percent}% (requested: ${requestedPercent}% of ${effectiveMax}%)`)
        .catch(() => {
          // send() already logs the failure; there's no live characteristic
          // write left to report it back to by the time this timer fires.
        });
    }, debounceMs);
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
