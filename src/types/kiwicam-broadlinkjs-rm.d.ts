declare module 'kiwicam-broadlinkjs-rm' {
  import { EventEmitter } from 'events';

  interface Host {
    address: string;
    port: number;
  }

  // Device does NOT actually extend EventEmitter at runtime - its constructor
  // creates an internal `this.emitter = new EventEmitter()` and only copies
  // over `on`, `emit`, and `removeListener` (not `once`, `off`, etc). Declaring
  // only what's really there so we don't call something that doesn't exist.
  export class Device {
    host: Host;
    mac: Buffer;
    type: number;
    model?: string;
    log: (...args: unknown[]) => void;
    debug: boolean;
    sendData(data: Buffer, debug?: boolean): Promise<void>;
    authenticate(): void;
    checkTemperature(): void;
    on(event: 'temperature', listener: (temperature: number, humidity: number) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    removeListener(event: 'temperature', listener: (temperature: number, humidity: number) => void): this;
    removeListener(event: string, listener: (...args: unknown[]) => void): this;
  }

  export default class Broadlink extends EventEmitter {
    devices: Record<string, Device | 'Not Supported'>;
    log?: (...args: unknown[]) => void;
    debug?: boolean;
    discover(): void;
    addDevice(host: Host, macAddress: Buffer, deviceType: number): void;
    on(event: 'deviceReady', listener: (device: Device) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
}
