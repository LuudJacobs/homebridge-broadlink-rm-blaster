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

export interface StripBlankEntriesResult {
  config: BlasterPlatformConfig;
  removed: string[];
}

function hasName(name: unknown): boolean {
  return typeof name === 'string' && name.trim().length > 0;
}

function describeRemoval(count: number, label: string, ownerName?: string): string {
  const rows = `${count} blank ${label} row${count === 1 ? '' : 's'}`;
  return ownerName ? `${rows} on "${ownerName}"` : rows;
}

function stripBlank<T extends { name?: string }>(list: T[]): { kept: T[]; removedCount: number } {
  const kept = list.filter((entry) => hasName(entry?.name));
  return { kept, removedCount: list.length - kept.length };
}

// The Config UI X form's array editor doesn't reliably omit empty/incomplete
// rows when it writes config.json on save (the same quirk already worked
// around at read time by isBlankEntry() in platform.ts and usableModes() in
// fanAccessory.ts). Since it can recur on any future save, actively strip
// what's unambiguously a placeholder row - no name at all - so it doesn't
// keep piling up in the file. Anything with a name but another problem (e.g.
// a mode missing its On signal) is left alone; that's a real misconfiguration
// the user still needs to see and fix, not a blank row.
export function stripBlankEntries(platformConfig: BlasterPlatformConfig): StripBlankEntriesResult {
  const removed: string[] = [];
  const config: BlasterPlatformConfig = { ...platformConfig };

  if (config.accessories) {
    const { kept, removedCount } = stripBlank(config.accessories);
    if (removedCount > 0) {
      removed.push(describeRemoval(removedCount, 'accessory'));
    }
    config.accessories = kept;
  }

  if (config.advancedAccessories) {
    const { kept, removedCount } = stripBlank(config.advancedAccessories);
    if (removedCount > 0) {
      removed.push(describeRemoval(removedCount, 'advanced accessory'));
    }
    config.advancedAccessories = kept;
  }

  if (config.dimmers) {
    const { kept, removedCount } = stripBlank(config.dimmers);
    if (removedCount > 0) {
      removed.push(describeRemoval(removedCount, 'dimmer'));
    }
    config.dimmers = kept;
  }

  if (config.tvs) {
    const { kept, removedCount } = stripBlank(config.tvs);
    if (removedCount > 0) {
      removed.push(describeRemoval(removedCount, 'TV'));
    }
    config.tvs = kept;
  }

  if (config.rmDevices) {
    const { kept, removedCount } = stripBlank(config.rmDevices);
    if (removedCount > 0) {
      removed.push(describeRemoval(removedCount, 'RM device'));
    }
    config.rmDevices = kept;
  }

  if (config.fans) {
    const { kept, removedCount } = stripBlank(config.fans);
    if (removedCount > 0) {
      removed.push(describeRemoval(removedCount, 'fan'));
    }
    config.fans = kept.map((fan) => {
      if (!fan.modes) {
        return fan;
      }
      const modesResult = stripBlank(fan.modes);
      if (modesResult.removedCount === 0) {
        return fan;
      }
      removed.push(describeRemoval(modesResult.removedCount, 'mode', fan.name));
      return { ...fan, modes: modesResult.kept };
    });
  }

  return { config, removed };
}
