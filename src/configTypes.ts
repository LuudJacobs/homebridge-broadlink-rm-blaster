import type { PlatformConfig } from 'homebridge';

import type { LastSeenFormat } from './mqttLastSeen';

export interface RmDeviceConfig {
  name: string;
  ip: string;
  enableTemperatureHumidity?: boolean;
  enableMqttPublish?: boolean;
  // Retain this device's readings, so a subscriber connecting later
  // immediately gets the last one. Defaults to on.
  mqttRetain?: boolean;
  // Overrides the platform-wide last_seen format for this device's own
  // sensor readings. Unset means "use the platform setting".
  mqttLastSeenFormat?: LastSeenFormat;
}

export type BasicAccessoryType = 'light' | 'switch' | 'outlet' | 'fan';

export interface BasicAccessoryConfig {
  name: string;
  rmDevice: string;
  accessoryType: BasicAccessoryType;
  powerOnCode: string;
  powerOffCode?: string;
  // Minimum time between accepting a real on/off transition. Defaults to 1
  // second when unset.
  switchCooldownSeconds?: number;
  // Listens for commands on <mqttBaseTopic>/<mqttTopic>/set and publishes
  // its on/off state to <mqttBaseTopic>/<mqttTopic>. Needs the platform's
  // MQTT settings to be filled in and enabled.
  mqttSubscribe?: boolean;
  mqttTopic?: string;
  // Retain this accessory's state message. Defaults to on.
  mqttRetain?: boolean;
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
  // Listens for commands on <mqttBaseTopic>/<mqttTopic>/set and publishes
  // its on/off state to <mqttBaseTopic>/<mqttTopic>. Needs the platform's
  // MQTT settings to be filled in and enabled.
  mqttSubscribe?: boolean;
  mqttTopic?: string;
  // Retain this accessory's state message. Defaults to on.
  mqttRetain?: boolean;
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
  // Minimum time between accepting a real on/off transition. Defaults to 1
  // second when unset.
  switchCooldownSeconds?: number;
  // Listens for commands on <mqttBaseTopic>/<mqttTopic>/set and publishes
  // its on/off state to <mqttBaseTopic>/<mqttTopic>. Needs the platform's
  // MQTT settings to be filled in and enabled.
  mqttSubscribe?: boolean;
  mqttTopic?: string;
  // Retain this accessory's state message. Defaults to on.
  mqttRetain?: boolean;
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
  // Start the fan oscillating whenever it is turned on, unless it already
  // is. Sent once the speed has settled.
  swingOnPowerOn?: boolean;

  // Dedicated power button, if there is one. powerToggleCode and
  // powerOnCode/powerOffCode are mutually exclusive.
  powerToggleCode?: string;
  powerOnCode?: string;
  powerOffCode?: string;
  // Minimum time between accepting a real on/off transition. Defaults to 1
  // second when unset.
  switchCooldownSeconds?: number;

  // A signal sent every time the fan is turned on, e.g. maxing out a
  // heater's thermostat.
  onFollowUpName?: string;
  onFollowUpCode?: string;
  onFollowUpPressCount?: number;

  modes?: FanModeConfig[];

  // Listens for commands on <mqttBaseTopic>/<mqttTopic>/set and publishes
  // its on/off state to <mqttBaseTopic>/<mqttTopic>. Needs the platform's
  // MQTT settings to be filled in and enabled.
  mqttSubscribe?: boolean;
  mqttTopic?: string;
  // Retain this accessory's state message. Defaults to on.
  mqttRetain?: boolean;

  // Exposes swing on its own switch as well as the fan's built-in
  // oscillate control. The learner turns this on when the fan carries
  // other services, since the Home app hides its oscillate control as
  // soon as an accessory is more than just a fan.
  swingSwitch?: boolean;

  // How long to wait for the speed slider to settle before acting on it.
  // HomeKit sends a value for every intermediate position while a slider
  // is dragged, and each one would otherwise fire its own presses.
  speedDebounceSeconds?: number;

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
  // Minimum time between accepting a real on/off transition. Defaults to 1
  // second when unset.
  switchCooldownSeconds?: number;
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
  // Listens for commands on <mqttBaseTopic>/<mqttTopic>/set and publishes
  // its on/off state to <mqttBaseTopic>/<mqttTopic>. Needs the platform's
  // MQTT settings to be filled in and enabled.
  mqttSubscribe?: boolean;
  mqttTopic?: string;
  // Retain this accessory's state message. Defaults to on.
  mqttRetain?: boolean;
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
  // The broker as "host:port"; the port half is optional and defaults to
  // 1883. Older configs kept the port in mqttPort instead - that's migrated
  // into here on startup, and still honoured as a fallback meanwhile.
  mqttHost?: string;
  /** @deprecated Folded into mqttHost. Only read to migrate an older config. */
  mqttPort?: number;
  // Whether the broker needs credentials. Undefined in an older config,
  // where it's inferred from whether a username/password was filled in.
  mqttRequiresAuth?: boolean;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttBaseTopic?: string;
  // Default last_seen format for every MQTT publish (sensor readings and
  // accessory state). Defaults to iso8601 when unset.
  mqttLastSeenFormat?: LastSeenFormat;
}
