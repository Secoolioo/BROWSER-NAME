import type { Disposable } from '../../shared/disposable.ts';
import { token, type Token } from '../di/token.ts';
import { Emitter, type Listener } from './emitter.ts';

/**
 * A typed application event, such as `TabActivated` or `SettingChanged`. The type
 * parameter is the payload.
 */
export interface EventType<T> {
  /** Name for diagnostics and logs. */
  readonly name: string;
  /**
   * Never set at runtime; only binds the payload type.
   * @internal
   */
  readonly payload?: T;
}

/**
 * Defines a new event type. Event types are compared by identity, not by name.
 * @param name - Name for diagnostics, conventionally in PascalCase.
 */
export function defineEvent<T>(name: string): EventType<T> {
  return Object.freeze({ name });
}

/** Receives listener errors of the {@link EventBus}. */
export type EventErrorHandler = (error: unknown, event: EventType<unknown>) => void;

/**
 * Publishes typed application events between modules that do not know each other. A
 * failing listener is reported to the error handler and does not stop the others.
 */
export class EventBus implements Disposable {
  private readonly emitters = new Map<EventType<unknown>, Emitter<unknown>>();
  private readonly onError: EventErrorHandler;

  /** @param onError - Receives errors thrown by listeners. */
  constructor(onError: EventErrorHandler) {
    this.onError = onError;
  }

  /**
   * Subscribes to an event type.
   * @param type - The event type.
   * @param listener - Receives each payload.
   * @returns A disposable that unsubscribes.
   */
  on<T>(type: EventType<T>, listener: Listener<T>): Disposable {
    return this.emitterFor(type).event(listener as Listener<unknown>);
  }

  /**
   * Subscribes to the next occurrence of an event type only.
   * @param type - The event type.
   * @param listener - Receives the payload once.
   */
  once<T>(type: EventType<T>, listener: Listener<T>): Disposable {
    const subscription = this.on(type, (payload) => {
      subscription.dispose();
      listener(payload);
    });
    return subscription;
  }

  /**
   * Delivers an event to all current subscribers.
   * @param type - The event type.
   * @param payload - The payload.
   */
  emit<T>(type: EventType<T>, payload: T): void {
    this.emitters.get(type)?.fire(payload);
  }

  /** Removes all subscriptions. */
  dispose(): void {
    for (const emitter of this.emitters.values()) {
      emitter.dispose();
    }
    this.emitters.clear();
  }

  private emitterFor(type: EventType<unknown>): Emitter<unknown> {
    let emitter = this.emitters.get(type);
    if (emitter === undefined) {
      emitter = new Emitter({ onListenerError: (error) => this.onError(error, type) });
      this.emitters.set(type, emitter);
    }
    return emitter;
  }
}

/** Token for the application-wide {@link EventBus}. */
export const EventBusToken: Token<EventBus> = token<EventBus>('EventBus');
