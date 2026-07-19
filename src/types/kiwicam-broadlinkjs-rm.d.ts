declare module 'kiwicam-broadlinkjs-rm' {
  import { EventEmitter } from 'events';

  interface Host {
    address: string;
    port: number;
  }

  export class Device extends EventEmitter {
    host: Host;
    mac: Buffer;
    type: number;
    model?: string;
    log: (...args: unknown[]) => void;
    debug: boolean;
    sendData(data: Buffer, debug?: boolean): Promise<void>;
    authenticate(): void;
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
