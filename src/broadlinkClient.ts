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

// kiwicam-broadlinkjs-rm's own Broadlink.addDevice() keys its internal device
// registry by MAC address, not by IP - passing the same placeholder MAC for
// every device (as this used to) means the second addDevice() call for a
// different IP hits the library's "already know this MAC, ignore" guard and
// silently never creates a Device or authenticates, no matter how many RM
// devices are configured. We don't have (and don't need) each device's real
// MAC - the device itself doesn't validate it for this direct-by-IP
// connection mode - so deriving a distinct placeholder per IP is enough to
// give every configured device its own slot in the library's registry.
export function placeholderMacForIp(ip: string): Buffer {
  const octets = ip.split('.').map(Number);
  return Buffer.from([0, 0, ...octets]);
}

export interface TemperatureHumidityReading {
  temperature: number;
  humidity: number;
}

export class BroadlinkClient {
  private readonly broadlink = new Broadlink();
  private readonly devices = new Map<string, Promise<Device>>();

  constructor(private readonly log: Logger) {}

  private getDevice(ip: string): Promise<Device> {
    let devicePromise = this.devices.get(ip);
    if (devicePromise) {
      return devicePromise;
    }

    devicePromise = new Promise<Device>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.broadlink.removeListener('deviceReady', onReady);
        reject(new Error(`Timed out authenticating with Broadlink RM at ${ip}`));
      }, AUTH_TIMEOUT_MS);

      const onReady = (device: Device) => {
        if (device.host.address !== ip) {
          return;
        }
        clearTimeout(timeout);
        this.broadlink.removeListener('deviceReady', onReady);
        this.log.info(`Connected to Broadlink RM at ${ip}`);
        resolve(device);
      };

      this.broadlink.on('deviceReady', onReady);
      this.broadlink.addDevice({ address: ip, port: BROADLINK_PORT }, placeholderMacForIp(ip), MANUAL_RM_DEVICE_TYPE);
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
