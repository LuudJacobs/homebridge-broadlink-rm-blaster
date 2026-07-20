import Broadlink, { Device } from 'kiwicam-broadlinkjs-rm';
import type { Logger } from 'homebridge';

// Device type code the library reserves for a manually added RM4 Pro (RF capable),
// used when connecting directly by IP instead of relying on UDP discovery.
const MANUAL_RM4_PRO_DEVICE_TYPE = 0x2227;
const BROADLINK_PORT = 80;
const AUTH_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 10_000;

export function parseHexCode(hexCode: string): Buffer {
  return Buffer.from(hexCode.replace(/\s+/g, ''), 'hex');
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
        reject(new Error(`Timed out authenticating with Broadlink RM4 Pro at ${ip}`));
      }, AUTH_TIMEOUT_MS);

      const onReady = (device: Device) => {
        if (device.host.address !== ip) {
          return;
        }
        clearTimeout(timeout);
        this.broadlink.removeListener('deviceReady', onReady);
        this.log.info(`Connected to Broadlink RM4 Pro at ${ip}`);
        resolve(device);
      };

      this.broadlink.on('deviceReady', onReady);
      this.broadlink.addDevice({ address: ip, port: BROADLINK_PORT }, Buffer.alloc(6, 0), MANUAL_RM4_PRO_DEVICE_TYPE);
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
        reject(new Error(`Timed out reading temperature/humidity from ${ip}`));
      }, READ_TIMEOUT_MS);

      device.once('temperature', (temperature, humidity) => {
        clearTimeout(timeout);
        resolve({ temperature, humidity });
      });

      device.checkTemperature();
    });
  }
}
