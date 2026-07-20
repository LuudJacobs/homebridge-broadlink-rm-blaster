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

// resolvePowerOnLevel's own `percent` is deliberately the admin's configured
// target, not the actual signal's percent (see its comment below) - this
// looks the real candidate back up by its code so logs can show what was
// actually sent, the same way setBrightness's log already does.
function findLevelByCode(config: DimmerAccessoryConfig, code: string): ResolvedLevel | undefined {
  return candidateLevels(config).find((level) => level.code === code);
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

  // Bumped by any explicit brightness/off action (setBrightness, turnOff).
  // setOn's own resolved default/last-known/max level is only a guess made
  // in the absence of a real request - if the user actually turned on by
  // dragging the slider itself (HomeKit sends On=true and Brightness=X for
  // the same gesture), setBrightness's onSet can fire while setOn's "Power
  // On" send is still in flight, and setOn must recognize its guess has been
  // superseded rather than blast/display it on top of the real request.
  //
  // This only guards the async gap of the Power On send itself (tens of
  // ms) - deliberately narrow. A wider, debounce-length delay before
  // sending the guessed level was tried (v0.7.4) and had to be reverted:
  // real-hardware testing showed it introduced a gap between Power On and
  // the level signal that the physical (KAKU-style RF) dimmer no longer
  // recognized as one combined "turn on to level X" gesture, causing the
  // receiver to become unresponsive after a few actions. Sending both
  // signals back-to-back, immediately, is what real-hardware testing has
  // shown to actually work reliably - this guard only trims the display-sync
  // edge case on top of that, it doesn't relax the immediacy.
  private brightnessActionId = 0;

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
    this.brightnessActionId++;
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
    const effectiveMax = getEffectiveMaxPercent(this.config);
    const nearestPercent = findLevelByCode(this.config, resolved.code)?.percent ?? resolved.percent;
    const myActionId = ++this.brightnessActionId;

    await this.send(this.config.powerOnCode, 'Power On');
    this.accessory.context.on = true;

    if (this.brightnessActionId !== myActionId) {
      // A real Brightness request (e.g. dragging the slider straight up
      // from off) arrived while "Power On" was still in flight and has
      // already taken over - don't blast or display this guessed level on
      // top of it.
      return;
    }

    // Power On only turns the light on - it doesn't carry a brightness level,
    // so the resolved level's own signal has to be sent right away too, for
    // the device to actually reach it. This has to stay immediate/back-to-back
    // with Power On, not deferred - see the comment on brightnessActionId.
    await this.send(resolved.code, `Brightness ${nearestPercent}% (requested: ${resolved.percent}% of ${effectiveMax}%)`);

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
    this.brightnessActionId++;

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
