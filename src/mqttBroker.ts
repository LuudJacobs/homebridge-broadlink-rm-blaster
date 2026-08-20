export const DEFAULT_MQTT_PORT = 1883;
export const DEFAULT_MQTT_BROKER = `localhost:${DEFAULT_MQTT_PORT}`;

export interface BrokerAddress {
  host: string;
  port: number;
}

// The broker is configured as a single "host:port" field. The port half is
// optional, and an older config that still keeps its port in a separate
// field passes it here as the fallback - so both shapes resolve the same
// way whether or not the config file itself has been migrated yet.
export function parseBrokerAddress(address: string | undefined, fallbackPort?: number): BrokerAddress | undefined {
  const text = (address ?? '').trim();
  if (!text) {
    return undefined;
  }

  const defaultPort = validPort(fallbackPort) ?? DEFAULT_MQTT_PORT;

  // A bracketed IPv6 literal keeps its own colons, so only what follows the
  // closing bracket can be a port.
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end === -1) {
      return { host: text, port: defaultPort };
    }
    const host = text.slice(0, end + 1);
    const rest = text.slice(end + 1);
    if (!rest.startsWith(':')) {
      return { host, port: defaultPort };
    }
    return { host, port: validPort(Number(rest.slice(1))) ?? defaultPort };
  }

  const firstColon = text.indexOf(':');
  if (firstColon === -1) {
    return { host: text, port: defaultPort };
  }
  // More than one colon and no brackets is a bare IPv6 literal, which has
  // no room for a port.
  if (text.indexOf(':', firstColon + 1) !== -1) {
    return { host: text, port: defaultPort };
  }

  const host = text.slice(0, firstColon).trim();
  const port = validPort(Number(text.slice(firstColon + 1).trim()));
  if (!host) {
    return undefined;
  }
  return { host, port: port ?? defaultPort };
}

function validPort(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value < 1 || value > 65535) {
    return undefined;
  }
  return value;
}
