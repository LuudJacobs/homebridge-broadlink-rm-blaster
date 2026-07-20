import type { PlatformConfig } from 'homebridge';

export type BasicAccessoryType = 'light' | 'switch' | 'outlet' | 'fan';

export interface BasicAccessoryConfig {
  name: string;
  ip?: string;
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
  ip?: string;
  powerOnCode: string;
  powerOffCode: string;
  useLastKnownBrightness?: boolean;
  useDefaultBrightnessLevel?: boolean;
  defaultBrightnessLevel?: number;
  useMaxBrightnessLevel?: boolean;
  maxBrightnessLevel?: number;
  useBrightnessUpDownSwitches?: boolean;
  brightnessSwitchesName?: string;
  hideBrightnessSlider?: boolean;
  zeroPercentCode: string;
  hundredPercentCode: string;
  debounceSeconds?: number;
  levels: BrightnessLevelConfig[];
}

export interface BlasterPlatformConfig extends PlatformConfig {
  defaultIp: string;
  showTemperatureHumidity?: boolean;
  temperatureSensorIp?: string;
  accessories?: BasicAccessoryConfig[];
  dimmers?: DimmerAccessoryConfig[];
}
