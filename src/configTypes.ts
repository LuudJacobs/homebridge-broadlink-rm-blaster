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

// An extra signal that has to follow a mode being activated - e.g. maxing
// out a heater's thermostat once heat mode is on.
export interface FanFollowUpConfig {
  name: string;
  code: string;
  pressCount: number;
  // When false, it is only sent the first time the mode is activated after
  // the fan is powered on, rather than on every activation. Never sent for
  // a plain level change either way.
  everyActivation?: boolean;
}

// Modes are either a plain on/off toggle, or a set of discrete levels.
// Levels are 0-indexed: level 0 is the lowest, and on some fans that lowest
// level *is* the mode being off (e.g. cooler off / 1 / 2 is levelCount 3).
export type FanModeKind = 'onoff' | 'levels';

export interface FanModeConfig {
  name: string;
  kind: FanModeKind;

  // kind === 'onoff'. offCode omitted means onCode is a toggle.
  onCode?: string;
  offCode?: string;

  // kind === 'levels'. downCode omitted means upCode is a single cycle
  // button that wraps back to level 0 after the top level.
  levelCount?: number;
  upCode?: string;
  downCode?: string;
  exposeAsSlider?: boolean;

  // Whether driving this mode also powers the whole fan on/off.
  powersOn?: boolean;
  powersOff?: boolean;

  // Whether the fan restores this mode's setting after a power cycle.
  remembersState?: boolean;

  followUp?: FanFollowUpConfig;
}

export interface FanSwingConfig {
  // The swing button. When offCode is omitted this one toggles swing.
  code: string;
  offCode?: string;
  remembersState?: boolean;
  powersOn?: boolean;
  powersOff?: boolean;
}

// Omitted entirely when the fan has no dedicated power button and is
// powered via a mode or swing instead. toggleCode and onCode/offCode are
// mutually exclusive.
export interface FanPowerConfig {
  toggleCode?: string;
  onCode?: string;
  offCode?: string;
}

export interface FanAccessoryConfig {
  name: string;
  rmDevice: string;
  pressIntervalSeconds?: number;
  power?: FanPowerConfig;
  swing?: FanSwingConfig;
  // The fan's own speed control, driving the Fanv2 tile's RotationSpeed.
  // Omitted for a single-speed fan, which has nothing to vary - its tile
  // is then just on/off, powered by `power` or by one of the modes.
  speed?: FanModeConfig;
  // Any further modes (Heat, Cooler, ...), each exposed as its own service.
  modes?: FanModeConfig[];
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
