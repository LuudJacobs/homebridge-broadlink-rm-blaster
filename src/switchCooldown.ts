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

  private tryAcceptNow(now: number): boolean {
    if (!this.isReady(now)) {
      return false;
    }
    this.lastAcceptedAt = now;
    return true;
  }

  // Applies immediately if the cooldown has cleared - a failure there
  // propagates to the caller exactly as an unthrottled call would. Otherwise
  // the signal is refused - onRefused fires so a caller can react (e.g.
  // snap a HomeKit tile back to its real state) - but it isn't just
  // dropped: the *first* refused signal in a window is held and applied
  // once the window clears. Any further signal during that same window is
  // refused the same way but dropped entirely rather than replacing the
  // held one - the first signal during a window is the one that eventually
  // takes effect. A failure from that later, deferred apply has nobody left
  // to propagate to, so it goes to onDeferredError instead of rejecting.
  async applyWhenReady(
    now: number,
    value: boolean,
    apply: (value: boolean) => Promise<void> | void,
    onRefused?: () => void,
    onDeferredError?: (error: unknown) => void,
  ): Promise<void> {
    if (this.tryAcceptNow(now)) {
      await apply(value);
      return;
    }
    onRefused?.();
    if (this.pending) {
      return;
    }
    const wait = this.cooldownMs - (now - this.lastAcceptedAt);
    this.pending = {
      value,
      timer: setTimeout(() => {
        const heldValue = this.pending!.value;
        this.pending = undefined;
        this.lastAcceptedAt = Date.now();
        // A wrapping async IIFE (rather than Promise.resolve(apply(...))
        // directly) so a *synchronous* throw from apply() is caught the
        // same way as an async rejection would be.
        (async () => {
          try {
            await apply(heldValue);
          } catch (error) {
            onDeferredError?.(error);
          }
        })();
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
