import type { PlatformConfig } from 'homebridge';

export type BasicAccessoryType = 'light' | 'switch' | 'outlet' | 'fan';

export interface BasicAccessoryConfig {
  name: string;
  ip?: string;
  accessoryType: BasicAccessoryType;
  powerOnCode: string;
  powerOffCode?: string;
}

export interface BlasterPlatformConfig extends PlatformConfig {
  defaultIp: string;
  accessories?: BasicAccessoryConfig[];
}
