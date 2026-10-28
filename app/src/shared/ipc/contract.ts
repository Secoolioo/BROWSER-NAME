import type * as v from 'valibot';

/**
 * What a view is allowed to call. Each view type gets only the capabilities it needs:
 * the shell gets `shell`, the overlay `overlay`, and internal pages `page:<name>`, such as
 * `page:settings`.
 */
export type Capability = 'shell' | 'overlay' | `page:${string}`;

/** A request-response channel between a renderer and the browser process. */
export interface RequestContract<Req, Res> {
  readonly kind: 'request';
  /** Dotted channel name, such as `tabs.activate`. */
  readonly channel: string;
  readonly request: v.GenericSchema<unknown, Req>;
  readonly response: v.GenericSchema<unknown, Res>;
  readonly capability: Capability;
  /** Maximum calls per second and sender. Defaults to 50. */
  readonly ratePerSecond?: number;
}

/** A one-way event channel from the browser process to renderers. */
export interface EventContract<T> {
  readonly kind: 'event';
  readonly channel: string;
  readonly payload: v.GenericSchema<unknown, T>;
  readonly capability: Capability;
}

/** Any contract. */
export type Contract = RequestContract<unknown, unknown> | EventContract<unknown>;

/** Request type of a request contract. */
export type RequestOf<C> = C extends RequestContract<infer Req, unknown> ? Req : never;
/** Response type of a request contract. */
export type ResponseOf<C> = C extends RequestContract<unknown, infer Res> ? Res : never;
/** Payload type of an event contract. */
export type PayloadOf<C> = C extends EventContract<infer T> ? T : never;

const channelPattern = /^[a-z][a-zA-Z]*(?:\.[a-z][a-zA-Z]*)+$/;

function checkChannel(channel: string): void {
  if (!channelPattern.test(channel)) {
    throw new Error(`IPC channel "${channel}" must be dotted camelCase`);
  }
}

/**
 * Declares a request-response channel.
 * @param contract - Channel, schemas and capability.
 */
export function defineRequest<Req, Res>(
  contract: Omit<RequestContract<Req, Res>, 'kind'>,
): RequestContract<Req, Res> {
  checkChannel(contract.channel);
  return Object.freeze({ kind: 'request', ...contract });
}

/**
 * Declares an event channel.
 * @param contract - Channel, payload schema and capability.
 */
export function defineEvent<T>(contract: Omit<EventContract<T>, 'kind'>): EventContract<T> {
  checkChannel(contract.channel);
  return Object.freeze({ kind: 'event', ...contract });
}
