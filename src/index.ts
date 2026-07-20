import type { API } from 'homebridge';

import { PLATFORM_NAME } from './settings';
import { BroadlinkRMBlasterPlatform } from './platform';

export = (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, BroadlinkRMBlasterPlatform);
};
