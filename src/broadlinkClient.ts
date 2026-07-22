import Broadlink, { Device } from 'kiwicam-broadlinkjs-rm';
import type { Logger } from 'homebridge';

// Device type code the library reserves for a manually added RM (RF capable),
// used when connecting directly by IP instead of relying on UDP discovery.
const MANUAL_RM_DEVICE_TYPE = 0x2227;
const BROADLINK_PORT = 80;
const AUTH_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 10_000;

export function parseHexCode(hexCode: string): Buffer {
  return Buffer.from(hexCode.replace(/\s+/g, ''), 'hex');
}

// The manual/direct-by-IP placeholder MAC. Confirmed (via a real regression:
// see the comment on broadlinkInstances below) that real Broadlink RM4 Pro
// units silently refuse to authenticate at all if this is anything other
// than all-zero - the actual device cares about this value even though it
// doesn't need to match a real MAC. Never change this to anything else
// without re-testing against real hardware directly (e.g. via the CLI, with
// nothing else running) first.
const PLACEHOLDER_MAC = Buffer.alloc(6, 0);

export interface TemperatureHumidityReading {
  temperature: number;
  humidity: number;
}

export class BroadlinkClient {
  // kiwicam-broadlinkjs-rm's own Broadlink.addDevice() keys its internal
  // device registry by MAC address, not by IP. Every device has to use the
  // same PLACEHOLDER_MAC (see above - the device itself breaks on any other
  // value), so a single shared Broadlink instance would let a second
  // device's addDevice() collide with the first's registry entry and
  // silently no-op, never authenticating. Giving each IP its own Broadlink
  // instance means each has its own private registry, so the identical
  // placeholder MAC never collides across devices.
  private readonly broadlinkInstances = new Map<string, Broadlink>();
  private readonly devices = new Map<string, Promise<Device>>();

  constructor(private readonly log: Logger) {}

  private getBroadlink(ip: string): Broadlink {
    let instance = this.broadlinkInstances.get(ip);
    if (!instance) {
      instance = new Broadlink();
      this.broadlinkInstances.set(ip, instance);
    }
    return instance;
  }

  private getDevice(ip: string): Promise<Device> {
    let devicePromise = this.devices.get(ip);
    if (devicePromise) {
      return devicePromise;
    }

    const broadlink = this.getBroadlink(ip);

    devicePromise = new Promise<Device>((resolve, reject) => {
      const timeout = setTimeout(() => {
        broadlink.removeListener('deviceReady', onReady);
        reject(new Error(`Timed out authenticating with Broadlink RM at ${ip}`));
      }, AUTH_TIMEOUT_MS);

      const onReady = (device: Device) => {
        if (device.host.address !== ip) {
          return;
        }
        clearTimeout(timeout);
        broadlink.removeListener('deviceReady', onReady);
        this.log.info(`Connected to Broadlink RM at ${ip}`);
        resolve(device);
      };

      broadlink.on('deviceReady', onReady);
      broadlink.addDevice({ address: ip, port: BROADLINK_PORT }, PLACEHOLDER_MAC, MANUAL_RM_DEVICE_TYPE);
    });

    devicePromise.catch(() => this.devices.delete(ip));
    this.devices.set(ip, devicePromise);
    return devicePromise;
  }

  async sendCode(ip: string, hexCode: string): Promise<void> {
    const device = await this.getDevice(ip);
    await device.sendData(parseHexCode(hexCode));
  }

  async readTemperatureHumidity(ip: string): Promise<TemperatureHumidityReading> {
    const device = await this.getDevice(ip);

    return new Promise<TemperatureHumidityReading>((resolve, reject) => {
      const timeout = setTimeout(() => {
        device.removeListener('temperature', onTemperature);
        reject(new Error(`Timed out reading temperature/humidity from ${ip}`));
      }, READ_TIMEOUT_MS);

      const onTemperature = (temperature: number, humidity: number) => {
        clearTimeout(timeout);
        device.removeListener('temperature', onTemperature);
        resolve({ temperature, humidity });
      };

      device.on('temperature', onTemperature);
      device.checkTemperature();
    });
  }
}
