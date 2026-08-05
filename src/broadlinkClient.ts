import Broadlink, { Device } from 'kiwicam-broadlinkjs-rm';
import type { Logger } from 'homebridge';
import type { NtfyNotifier } from './ntfyNotifier';

// Device type code the library reserves for a manually added RM (RF capable),
// used when connecting directly by IP instead of relying on UDP discovery.
const MANUAL_RM_DEVICE_TYPE = 0x2227;
const BROADLINK_PORT = 80;
const AUTH_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 10_000;
const LEARN_POLL_INTERVAL_MS = 1_000;
const LEARN_TIMEOUT_MS = 20_000;

export function parseHexCode(hexCode: string): Buffer {
  return Buffer.from(hexCode.replace(/\s+/g, ''), 'hex');
}

// Builds the raw "find RF packet at a known frequency" command - matches
// python-broadlink's rmpro.find_rf_packet(frequency=...), which is what
// actually works reliably (confirmed: our own blind-sweep attempt via
// enterRFSweep()/checkRFData()/checkRFData2() failed on real hardware, while
// this known-frequency approach - same as the learn-broadlink-rm4-codes
// Python project - succeeded for IR; RF still needed this fix).
//
// The "new firmware"/RM4-generation wire format (confirmed against
// python-broadlink's actual rmminib._send, not guessed) is
// [length:2][command:4][data], all little-endian, where length = data.length
// + 4. kiwicam-broadlinkjs-rm's own request_header ([0x04, 0x00]) is only
// the length prefix for an EMPTY data payload, and its command-sending
// methods (checkData() etc) only send a 1-byte command instead of the full
// 4-byte one - both of those gaps are silently absorbed by AES block padding
// for empty-payload commands, which is why checkData()/enterLearning() work
// fine despite being technically malformed. That padding can't save a
// command with a real (non-zero) payload like this one: the frequency bytes
// would land 3 bytes early, inside what should still be the command field.
// So this builds the full, correct frame by hand instead of reusing
// request_header.
export function buildFindRfPacket(frequencyMHz: number): Buffer {
  const data = Buffer.alloc(4);
  data.writeUInt32LE(Math.round(frequencyMHz * 1000), 0);

  const length = Buffer.alloc(2);
  length.writeUInt16LE(data.length + 4, 0);

  const command = Buffer.alloc(4);
  command.writeUInt32LE(0x1b, 0);

  return Buffer.concat([length, command, data]);
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

  constructor(private readonly log: Logger, private readonly notifier?: NtfyNotifier) {}

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
        const error = new Error(`Timed out authenticating with Broadlink RM at ${ip}`);
        this.notifier?.notifyConnectionFailure(
          ip,
          'Timed out authenticating with Broadlink RM. Check Homebridge logs for more details.',
        );
        reject(error);
      }, AUTH_TIMEOUT_MS);

      const onReady = (device: Device) => {
        if (device.host.address !== ip) {
          return;
        }
        clearTimeout(timeout);
        broadlink.removeListener('deviceReady', onReady);
        this.log.info(`Connected to Broadlink RM at ${ip}`);
        this.notifier?.notifyConnectionRecovered(ip);
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

  // Establishes (or reuses, since getDevice caches per IP) a connection
  // without sending any command - lets a caller wait for a real connection
  // and report on it before prompting for anything time-sensitive (e.g. "now
  // press the button on the remote").
  async connect(ip: string): Promise<void> {
    await this.getDevice(ip);
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

  // Waits for `event` to fire, actively re-issuing `poll()` at a fixed
  // interval in the meantime (this library never pushes learning data
  // unprompted - it has to be asked again on a timer, same pattern as the
  // Python reference project this CLI flow is modeled on). `signal` lets the
  // caller cancel mid-wait (Ctrl-C / "press q to cancel" in the learner CLI).
  private waitForEvent(
    device: Device,
    event: 'rawData',
    poll: () => void,
    signal: AbortSignal,
    timeoutMessage: string,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Cancelled'));
        return;
      }

      const cleanup = () => {
        clearTimeout(timeout);
        clearInterval(interval);
        device.removeListener(event, onData);
        signal.removeEventListener('abort', onAbort);
      };
      const onData = (data: Buffer) => {
        cleanup();
        resolve(data);
      };
      const onAbort = () => {
        cleanup();
        reject(new Error('Cancelled'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(timeoutMessage));
      }, LEARN_TIMEOUT_MS);
      const interval = setInterval(poll, LEARN_POLL_INTERVAL_MS);

      device.on(event, onData);
      signal.addEventListener('abort', onAbort);
    });
  }

  // One-shot: press the remote button any time after this is called.
  async learnIrCode(ip: string, signal: AbortSignal): Promise<string> {
    const device = await this.getDevice(ip);
    device.enterLearning();
    try {
      const data = await this.waitForEvent(device, 'rawData', () => device.checkData(), signal, 'Timed out waiting for a signal.');
      return data.toString('hex');
    } finally {
      device.cancelLearn();
    }
  }

  // Known-frequency RF learning (see buildFindRfPacket above for why) - also
  // one-shot: press the button any time after this is called, same as IR.
  async learnRfCode(ip: string, frequencyMHz: number, signal: AbortSignal): Promise<string> {
    const device = await this.getDevice(ip);
    await device.sendPacket(0x6a, buildFindRfPacket(frequencyMHz));
    try {
      const data = await this.waitForEvent(device, 'rawData', () => device.checkData(), signal, 'Timed out waiting for a signal.');
      return data.toString('hex');
    } finally {
      device.cancelLearn();
    }
  }
}
