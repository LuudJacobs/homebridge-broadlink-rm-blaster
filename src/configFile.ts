import * as fs from 'fs';
import * as path from 'path';

import { PLATFORM_NAME } from './settings';
import type { BlasterPlatformConfig } from './configTypes';

export interface HomebridgeConfigFile {
  platforms?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export function findConfigPath(explicitPath?: string): string {
  const configPath = explicitPath ?? path.join(process.cwd(), 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Could not find a config.json at "${configPath}". Run this from your Homebridge storage ` +
      'directory, or pass --config <path>.',
    );
  }
  return configPath;
}

export function findPlatformBlock(config: HomebridgeConfigFile): BlasterPlatformConfig | undefined {
  return config.platforms?.find((platform) => platform.platform === PLATFORM_NAME) as BlasterPlatformConfig | undefined;
}

export function backupConfig(configPath: string): void {
  fs.copyFileSync(configPath, `${configPath}.backup`);
}

export function writeConfigAtomically(configPath: string, config: HomebridgeConfigFile): void {
  const tempPath = path.join(path.dirname(configPath), `.${path.basename(configPath)}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(tempPath, configPath);
}
