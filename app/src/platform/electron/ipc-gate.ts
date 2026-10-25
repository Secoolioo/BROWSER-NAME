import * as v from 'valibot';
import { toDisposable, type Disposable } from '../../shared/disposable.ts';
import type { Capability, RequestContract } from '../../shared/ipc/contract.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { Clock } from '../../kernel/time/clock.ts';

/** A view of the browser that may talk to the browser process. */
export interface RegisteredView {
  /** Origin its top frame must have, such as `app://shell`. */
  readonly origin: string;
  readonly capabilities: ReadonlySet<Capability>;
}

/** Where an IPC message came from. */
export interface IpcSender {
  /** Id of the sending `WebContents`. */
  readonly viewId: number;
  /** URL of the sending frame. */
  readonly frameUrl: string;
  /** Whether the sending frame is the top frame of its view. */
  readonly isMainFrame: boolean;
}

/** Why a message was refused. */
export type IpcRejection =
  | 'unknown-sender'
  | 'not-main-frame'
  | 'wrong-origin'
  | 'missing-capability'
  | 'invalid-payload'
  | 'rate-limited';

interface Bucket {
  tokens: number;
  updated: number;
}

/**
 * Decides whether an IPC request is accepted, in this order: the sender is a registered
 * view, the message comes from its top frame with the expected origin, the view has the
 * contract's capability, the payload matches the schema, and the sender is within the
 * channel's rate limit. Web content never passes the first check.
 */
export class IpcGate {
  private readonly views = new Map<number, RegisteredView>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly clock: Clock;

  /** @param clock - Time source for rate limiting. */
  constructor(clock: Clock) {
    this.clock = clock;
  }

  /**
   * Registers a view of the browser's own UI.
   * @param viewId - Id of its `WebContents`.
   * @param view - Expected origin and capabilities.
   * @returns A disposable that unregisters the view.
   */
  registerView(viewId: number, view: RegisteredView): Disposable {
    this.views.set(viewId, view);
    return toDisposable(() => {
      if (this.views.get(viewId) === view) {
        this.views.delete(viewId);
      }
      for (const key of this.buckets.keys()) {
        if (key.startsWith(`${viewId}:`)) {
          this.buckets.delete(key);
        }
      }
    });
  }

  /**
   * Tells whether a view may receive events of a capability.
   * @param viewId - Id of a `WebContents`.
   * @param capability - The capability of an event contract.
   */
  mayReceive(viewId: number, capability: Capability): boolean {
    return this.views.get(viewId)?.capabilities.has(capability) === true;
  }

  /**
   * Checks a request.
   * @param contract - The channel's contract.
   * @param sender - Where the request came from.
   * @param payload - The untrusted payload.
   * @returns The validated request, or the reason for refusing it.
   */
  check<Req>(
    contract: RequestContract<Req, unknown>,
    sender: IpcSender,
    payload: unknown,
  ): Result<Req, IpcRejection> {
    const view = this.views.get(sender.viewId);
    if (view === undefined) {
      return err('unknown-sender');
    }
    if (!sender.isMainFrame) {
      return err('not-main-frame');
    }
    if (originOf(sender.frameUrl) !== view.origin) {
      return err('wrong-origin');
    }
    if (!view.capabilities.has(contract.capability)) {
      return err('missing-capability');
    }
    const parsed = v.safeParse(contract.request, payload);
    if (!parsed.success) {
      return err('invalid-payload');
    }
    if (!this.take(`${sender.viewId}:${contract.channel}`, contract.ratePerSecond ?? 50)) {
      return err('rate-limited');
    }
    return ok(parsed.output);
  }

  /** Token bucket that allows bursts up to one second's worth of calls. */
  private take(key: string, perSecond: number): boolean {
    const now = this.clock.now();
    const bucket = this.buckets.get(key) ?? { tokens: perSecond, updated: now };
    bucket.tokens = Math.min(
      perSecond,
      bucket.tokens + ((now - bucket.updated) / 1000) * perSecond,
    );
    bucket.updated = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens < 1) {
      return false;
    }
    bucket.tokens -= 1;
    return true;
  }
}

/**
 * The origin of a URL for the browser's own schemes, such as `app://shell`.
 * @param url - A frame URL.
 */
export function originOf(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(url);
  return match?.[1] === undefined
    ? ''
    : `${match[1].toLowerCase()}://${(match[2] ?? '').toLowerCase()}`;
}
