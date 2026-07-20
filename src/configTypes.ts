import type { PlatformConfig } from 'homebridge';

export interface RmDeviceConfig {
  name: string;
  ip: string;
  enableTemperatureHumidity?: boolean;
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
  dimmers?: DimmerAccessoryConfig[];
  tvs?: TvAccessoryConfig[];
}
