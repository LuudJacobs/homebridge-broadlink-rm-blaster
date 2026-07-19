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
  isDefault?: boolean;
  isMax?: boolean;
}

export interface DimmerAccessoryConfig {
  name: string;
  ip?: string;
  powerOnCode?: string;
  powerOffCode?: string;
  useLastKnownBrightness?: boolean;
  zeroPercentCode: string;
  levels: BrightnessLevelConfig[];
}

export interface BlasterPlatformConfig extends PlatformConfig {
  defaultIp: string;
  accessories?: BasicAccessoryConfig[];
  dimmers?: DimmerAccessoryConfig[];
}
