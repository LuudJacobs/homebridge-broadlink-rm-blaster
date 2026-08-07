// What an MQTT message is asking an accessory to do. Every field is
// optional: anything absent is left alone, so a message can carry just the
// one thing it cares about. Not every accessory understands every field -
// a plain switch only looks at `state`.
export interface MqttCommand {
  state?: 'on' | 'off';
  speedPercent?: number;
  levelPercent?: number;
  swing?: boolean;
}

function readOnOff(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text === 'on' || text === 'true') {
      return true;
    }
    if (text === 'off' || text === 'false') {
      return false;
    }
  }
  return undefined;
}

function readPercent(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return undefined;
  }
  return Math.min(Math.max(number, 0), 100);
}

// Returns undefined when there is nothing usable in the payload at all, so
// a malformed message can be reported rather than silently doing nothing.
export function parseMqttCommand(payload: string): MqttCommand | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const body = parsed as Record<string, unknown>;
  const command: MqttCommand = {};

  const state = readOnOff(body.state);
  if (state !== undefined) {
    command.state = state ? 'on' : 'off';
  }

  const speed = readPercent(body.speed);
  if (speed !== undefined) {
    command.speedPercent = speed;
  }

  const level = readPercent(body.level);
  if (level !== undefined) {
    command.levelPercent = level;
  }

  const swing = readOnOff(body.swing);
  if (swing !== undefined) {
    command.swing = swing;
  }

  return Object.keys(command).length > 0 ? command : undefined;
}
