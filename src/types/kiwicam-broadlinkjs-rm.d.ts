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
    // Learning-mode methods (IR - one-shot).
    enterLearning(): void;
    checkData(): void;
    cancelLearn(): void;
    // Public low-level send, used to send the known-frequency RF learning
    // packet built by hand (see buildFindRfPacket in broadlinkClient.ts) -
    // the library's own RF learning helpers only support a blind frequency
    // sweep, which didn't work reliably against real hardware.
    sendPacket(command: number, payload: Buffer, debug?: boolean): Promise<void>;
    on(event: 'temperature', listener: (temperature: number, humidity: number) => void): this;
    on(event: 'rawData', listener: (data: Buffer) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
    removeListener(event: 'temperature', listener: (temperature: number, humidity: number) => void): this;
    removeListener(event: 'rawData', listener: (data: Buffer) => void): this;
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
