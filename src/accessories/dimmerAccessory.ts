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

// The inverse of remapToPhysicalPercent - converts an actual/physical level
// (e.g. a candidate landed on by up/down stepping) back into the logical
// 0-100 scale the slider and displayed brightness use, so a physical 25%
// signal under a 50% max appears as logical 50% everywhere, consistent with
// how the slider itself represents a capped range.
export function remapToLogicalPercent(physicalPercent: number, config: DimmerAccessoryConfig): number {
  const effectiveMax = getEffectiveMaxPercent(config);
  if (effectiveMax <= 0) {
    return 0;
  }
  return (physicalPercent * 100) / effectiveMax;
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

export type BrightnessStepDirection = 'up' | 'down';

// Candidates are the configured levels + the required 0%/100% boundaries,
// capped to the configured max and sorted ascending, so "up" can never step
// above the cap and both directions just move to the adjacent index here.
export function resolveStepTarget(
  config: DimmerAccessoryConfig,
  currentPercent: number,
  direction: BrightnessStepDirection,
): ResolvedLevel | undefined {
  const effectiveMax = getEffectiveMaxPercent(config);
  const candidates = candidateLevels(config)
    .filter((level) => level.percent <= effectiveMax)
    .sort((a, b) => a.percent - b.percent);

  const currentIndex = candidates.reduce((closestIndex, candidate, index) =>
    Math.abs(candidate.percent - currentPercent) < Math.abs(candidates[closestIndex].percent - currentPercent)
      ? index
      : closestIndex,
  0);

  const targetIndex = direction === 'up' ? currentIndex + 1 : currentIndex - 1;
  return candidates[targetIndex];
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

    // Hiding the slider only makes sense once the up/down switches are the
    // way brightness gets controlled - if up/down get turned off later, the
    // slider should reappear rather than stay permanently hidden.
    if (!(this.config.useBrightnessUpDownSwitches && this.config.hideBrightnessSlider)) {
      service.getCharacteristic(this.platform.Characteristic.Brightness)
        .onGet(() => this.getBrightness())
        .onSet((value) => this.setBrightness(value));
    }
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
    await this.send(this.config.powerOffCode ?? this.config.zeroPercentCode, 'Power Off');
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

    await this.send(this.config.powerOnCode ?? resolved.code, 'Power On');

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

  // Called by BrightnessStepSwitchAccessory - a dimmer's up/down switches are
  // separate HomeKit accessories, so they hold a reference to this instance
  // rather than duplicating state via some other cross-accessory channel.
  async stepBrightness(direction: BrightnessStepDirection): Promise<void> {
    this.clearBrightnessDebounce();

    // "Current position" for finding the next step must be on the physical
    // scale (lastKnownLevel.percent) to compare correctly against
    // resolveStepTarget's physical candidate list - brightnessPercent is the
    // logical/displayed value and only equals the physical one when no max
    // is configured, which is why this only broke once a max cap was set.
    const lastKnown = this.accessory.context.lastKnownLevel as ResolvedLevel | undefined;
    const currentPhysicalPercent = this.accessory.context.on ? (lastKnown?.percent ?? 0) : 0;
    const target = resolveStepTarget(this.config, currentPhysicalPercent, direction);

    if (!target) {
      return;
    }

    if (target.percent === 0) {
      await this.turnOff();
      this.accessory.getService(this.platform.Service.Lightbulb)
        ?.updateCharacteristic(this.platform.Characteristic.On, false);
      return;
    }

    const effectiveMax = getEffectiveMaxPercent(this.config);
    const displayPercent = remapToLogicalPercent(target.percent, this.config);

    await this.send(target.code, `Brightness ${target.percent}% (requested: ${displayPercent}% of ${effectiveMax}%)`);

    this.accessory.context.on = true;
    this.accessory.context.brightnessPercent = displayPercent;
    this.accessory.context.lastKnownLevel = target;

    const service = this.accessory.getService(this.platform.Service.Lightbulb);
    service?.updateCharacteristic(this.platform.Characteristic.On, true);
    service?.updateCharacteristic(this.platform.Characteristic.Brightness, displayPercent);
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
