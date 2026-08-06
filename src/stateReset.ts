import * as fs from 'fs';
import * as path from 'path';

// Resets are queued in the Homebridge storage directory rather than
// applied straight to Homebridge's accessory cache. A running Homebridge
// holds every accessory in memory and rewrites that cache as it goes, so
// editing it underneath would achieve nothing and then be overwritten.
// Leaving a note the plugin picks up on its next start means the manager
// works whether or not Homebridge is running - which matters, because it
// is normally run from the Homebridge UI's own terminal.
const RESET_QUEUE_FILE = 'broadlink-rm-blaster-resets.json';

interface ResetQueue {
  uuids: string[];
}

export function resetQueuePath(storageDir: string): string {
  return path.join(storageDir, RESET_QUEUE_FILE);
}

function readQueue(queuePath: string): string[] {
  if (!fs.existsSync(queuePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf8')) as ResetQueue;
    return Array.isArray(parsed.uuids) ? parsed.uuids : [];
  } catch {
    return [];
  }
}

// Adds to whatever is already queued, so two manager sessions before a
// single restart don't lose each other's resets.
export function queueResets(storageDir: string, uuids: string[]): string {
  const queuePath = resetQueuePath(storageDir);
  const merged = [...new Set([...readQueue(queuePath), ...uuids])];
  const tempPath = path.join(storageDir, `.${RESET_QUEUE_FILE}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify({ uuids: merged }, null, 2)}\n`);
  fs.renameSync(tempPath, queuePath);
  return queuePath;
}

// Returns the queued UUIDs and clears the queue. Failing to remove the
// file would replay the reset on every restart, so a queue that can't be
// cleared is reported as empty instead.
export function consumeResets(storageDir: string): string[] {
  const queuePath = resetQueuePath(storageDir);
  const uuids = readQueue(queuePath);
  if (uuids.length === 0) {
    if (fs.existsSync(queuePath)) {
      try {
        fs.unlinkSync(queuePath);
      } catch {
        // Nothing queued anyway.
      }
    }
    return [];
  }
  try {
    fs.unlinkSync(queuePath);
  } catch {
    return [];
  }
  return uuids;
}
