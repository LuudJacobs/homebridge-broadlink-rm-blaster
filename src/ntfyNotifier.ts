import type { Logger } from 'homebridge';

const NTFY_BASE_URL = 'https://ntfy.sh';

// Tracks which RM devices we've already sent a failure notification for, so
// a device that's down for a while only triggers one notification instead of
// one per failed request. Cleared once the device connects successfully
// again, so a later outage notifies again.
export class NtfyNotifier {
  private readonly notifiedIps = new Set<string>();

  constructor(
    private readonly log: Logger,
    private readonly topic: string | undefined,
    private readonly deviceNames: Map<string, string>,
  ) {}

  notifyConnectionFailure(ip: string, error: Error): void {
    if (!this.topic || this.notifiedIps.has(ip)) {
      return;
    }
    this.notifiedIps.add(ip);

    const deviceName = this.deviceNames.get(ip) ?? ip;
    fetch(`${NTFY_BASE_URL}/${this.topic}`, {
      method: 'POST',
      headers: { Title: `Homebridge: Connection to Broadlink ${deviceName} Failed!` },
      body: error.message,
    }).catch((notifyError: unknown) => {
      const message = notifyError instanceof Error ? notifyError.message : String(notifyError);
      this.log.warn(`Failed to send ntfy notification: ${message}`);
    });
  }

  notifyConnectionRecovered(ip: string): void {
    this.notifiedIps.delete(ip);
  }
}
