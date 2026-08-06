import * as crypto from 'crypto';

import { PLUGIN_NAME } from './settings';

// The config array each accessory type lives in, its heading in the
// manager CLI, and the prefix its HomeKit UUID is derived from. Keeping
// these in one place is what stops the platform and the manager from
// disagreeing about which cached accessory belongs to which config entry.
export interface DeviceKind {
  configKey: 'accessories' | 'advancedAccessories' | 'fans' | 'dimmers' | 'tvs';
  title: string;
  uuidPrefix: string;
}

export const DEVICE_KINDS: DeviceKind[] = [
  { configKey: 'accessories', title: 'Simple On/Off Accessories', uuidPrefix: '' },
  { configKey: 'advancedAccessories', title: 'Advanced Accessories', uuidPrefix: 'advanced:' },
  { configKey: 'fans', title: 'Fans', uuidPrefix: 'fan:' },
  { configKey: 'dimmers', title: 'Dimmer Lights', uuidPrefix: 'dimmer:' },
  { configKey: 'tvs', title: 'TVs', uuidPrefix: 'tv:' },
];

export function accessoryUuidSeed(uuidPrefix: string, name: string): string {
  return `${PLUGIN_NAME}:${uuidPrefix}${name}`;
}

// Same derivation hap-nodejs uses for uuid.generate. Reimplemented rather
// than imported because hap-nodejs is only available inside Homebridge,
// and the CLIs run standalone - a test pins this against the real thing.
export function generateUuid(seed: string): string {
  const hash = crypto.createHash('sha1').update(seed).digest('hex');
  let index = -1;
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    index += 1;
    if (character === 'y') {
      return ((parseInt(`0x${hash[index]}`, 16) & 0x3) | 0x8).toString(16);
    }
    return hash[index];
  });
}
