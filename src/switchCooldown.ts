// A minimum time between accepting real on/off transitions, shared by every
// accessory type that can flap (a rapid double-tap, or a remote/automation
// firing signals faster than the device can keep up). `now` is a parameter
// throughout rather than read internally so this stays pure and testable.
export class SwitchCooldown {
  private lastAcceptedAt = -Infinity;
  private pending?: { value: boolean; timer: NodeJS.Timeout };

  constructor(private readonly cooldownMs: number) {}

  isReady(now: number): boolean {
    return now - this.lastAcceptedAt >= this.cooldownMs;
  }

  // HomeKit path: a signal inside the window is simply refused. Only a
  // signal that's actually accepted resets the window - a burst of refused
  // taps never pushes it out further.
  tryAcceptNow(now: number): boolean {
    if (!this.isReady(now)) {
      return false;
    }
    this.lastAcceptedAt = now;
    return true;
  }

  // MQTT path: nothing to visually snap back, so instead of refusing, hold
  // the latest requested value and apply it once the window clears. A
  // second call before then just replaces the held value - the most recent
  // one wins, and it still doesn't push the window out further.
  async applyWhenReady(now: number, value: boolean, apply: (value: boolean) => Promise<void> | void): Promise<void> {
    if (this.tryAcceptNow(now)) {
      await apply(value);
      return;
    }
    if (this.pending) {
      this.pending.value = value;
      return;
    }
    const wait = this.cooldownMs - (now - this.lastAcceptedAt);
    this.pending = {
      value,
      timer: setTimeout(() => {
        const heldValue = this.pending!.value;
        this.pending = undefined;
        this.lastAcceptedAt = Date.now();
        void apply(heldValue);
      }, wait),
    };
  }

  cancelPending(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = undefined;
    }
  }
}
