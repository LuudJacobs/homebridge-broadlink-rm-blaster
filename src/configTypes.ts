import type { PlatformConfig } from 'homebridge';

export interface RmDeviceConfig {
  name: string;
  ip: string;
  enableTemperatureHumidity?: boolean;
  enableMqttPublish?: boolean;
}

export type BasicAccessoryType = 'light' | 'switch' | 'outlet' | 'fan';

export interface BasicAccessoryConfig {
  name: string;
  rmDevice: string;
  accessoryType: BasicAccessoryType;
  powerOnCode: string;
  powerOffCode?: string;
}

export interface BrightnessLevelConfig {
  level: number;
  code: string;
}

export interface DimmerAccessoryConfig {
  name: string;
  rmDevice: string;
  powerOnCode: string;
  powerOffCode: string;
  useLastKnownBrightness?: boolean;
  useDefaultBrightnessLevel?: boolean;
  defaultBrightnessLevel?: number;
  useMaxBrightnessLevel?: boolean;
  maxBrightnessLevel?: number;
  zeroPercentCode: string;
  hundredPercentCode: string;
  debounceSeconds?: number;
  levels: BrightnessLevelConfig[];
}

export interface AdvancedSignalConfig {
  code: string;
}

export interface AdvancedAccessoryConfig {
  name: string;
  rmDevice: string;
  signals: AdvancedSignalConfig[];
  offCode?: string;
  timeoutSeconds?: number;
}

// An extra on/off feature of a fan (cooling, ioniser, ...) - a plain
// toggle, with no levels of its own.
export interface FanModeConfig {
  name: string;
  // offCode omitted means onCode is a toggle.
  onCode: string;
  offCode?: string;
  // Whether driving this feature also powers the whole fan on/off.
  powersOn?: boolean;
  powersOff?: boolean;
  // Whether the fan still has this on after a power cycle.
  remembers?: boolean;
}

export interface FanAccessoryConfig {
  name: string;
  rmDevice: string;
  pressIntervalSeconds?: number;

  // Speed. Omitted (or 1) for a fan with nothing to vary, whose tile is
  // then just on/off. speedDownCode omitted means speedUpCode is a single
  // cycle button that wraps back round after the top speed.
  speedCount?: number;
  speedUpCode?: string;
  speedDownCode?: string;
  // Whether stepping the speed up powers the fan on, and whether its
  // lowest speed is really the fan being off.
  speedPowersOn?: boolean;
  speedPowersOff?: boolean;
  // Whether the fan comes back at its previous speed, rather than needing
  // the speed button pressed to get going again.
  speedResumes?: boolean;

  // Swing. swingOffCode omitted means swingCode is a toggle.
  swingCode?: string;
  swingOffCode?: string;
  swingRemembers?: boolean;
  swingPowersOn?: boolean;
  swingPowersOff?: boolean;

  // Dedicated power button, if there is one. powerToggleCode and
  // powerOnCode/powerOffCode are mutually exclusive.
  powerToggleCode?: string;
  powerOnCode?: string;
  powerOffCode?: string;

  // A signal sent every time the fan is turned on, e.g. maxing out a
  // heater's thermostat.
  onFollowUpName?: string;
  onFollowUpCode?: string;
  onFollowUpPressCount?: number;

  modes?: FanModeConfig[];

  // Exposes a momentary switch that clears what the plugin thinks the fan
  // is doing, without sending any signals - for when the fan has been used
  // from its own remote and HomeKit no longer matches reality.
  resyncSwitch?: boolean;
}

export interface TvAccessoryConfig {
  name: string;
  rmDevice: string;
  powerOnCode: string;
  powerOffCode?: string;
  volumeUpCode?: string;
  volumeDownCode?: string;
  muteCode?: string;
  arrowUpCode?: string;
  arrowDownCode?: string;
  arrowLeftCode?: string;
  arrowRightCode?: string;
  selectCode?: string;
  infoCode?: string;
  backCode?: string;
  exitCode?: string;
}

export interface BlasterPlatformConfig extends PlatformConfig {
  rmDevices: RmDeviceConfig[];
  accessories?: BasicAccessoryConfig[];
  advancedAccessories?: AdvancedAccessoryConfig[];
  dimmers?: DimmerAccessoryConfig[];
  fans?: FanAccessoryConfig[];
  tvs?: TvAccessoryConfig[];
  ntfyTopic?: string;
  enableMqtt?: boolean;
  mqttHost?: string;
  mqttPort?: number;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttBaseTopic?: string;
  mqttRetain?: boolean;
}
