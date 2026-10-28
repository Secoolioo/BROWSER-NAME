import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../events/emitter.ts';
import { EventBus, defineEvent } from '../events/event-bus.ts';

describe('Emitter', () => {
  it('delivers values to listeners until they unsubscribe', () => {
    const emitter = new Emitter<number>();
    const listener = vi.fn();
    const subscription = emitter.event(listener);
    emitter.fire(1);
    subscription.dispose();
    emitter.fire(2);
    expect(listener.mock.calls).toEqual([[1]]);
    expect(emitter.listenerCount).toBe(0);
  });

  it('applies subscriptions made during delivery from the next fire', () => {
    const emitter = new Emitter<string>();
    const late = vi.fn();
    emitter.event(() => void emitter.event(late));
    emitter.fire('a');
    expect(late).not.toHaveBeenCalled();
    emitter.fire('b');
    expect(late).toHaveBeenCalledWith('b');
  });

  it('runs all listeners and rethrows the first error without a handler', () => {
    const emitter = new Emitter<void>();
    const second = vi.fn();
    emitter.event(() => {
      throw new Error('first');
    });
    emitter.event(second);
    expect(() => emitter.fire()).toThrow('first');
    expect(second).toHaveBeenCalledOnce();
  });

  it('reports listener errors to the handler', () => {
    const onListenerError = vi.fn();
    const emitter = new Emitter<void>({ onListenerError });
    emitter.event(() => {
      throw new Error('x');
    });
    expect(() => emitter.fire()).not.toThrow();
    expect(onListenerError).toHaveBeenCalledWith(new Error('x'));
  });

  it('ignores subscriptions after disposal', () => {
    const emitter = new Emitter<number>();
    emitter.dispose();
    const listener = vi.fn();
    emitter.event(listener).dispose();
    emitter.fire(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('EventBus', () => {
  const TabActivated = defineEvent<{ tabId: string }>('TabActivated');
  const Other = defineEvent<{ tabId: string }>('TabActivated');

  it('routes events by type identity', () => {
    const bus = new EventBus(() => {});
    const listener = vi.fn();
    bus.on(TabActivated, listener);
    bus.emit(Other, { tabId: 'b' });
    bus.emit(TabActivated, { tabId: 'a' });
    expect(listener.mock.calls).toEqual([[{ tabId: 'a' }]]);
  });

  it('delivers once-listeners a single time', () => {
    const bus = new EventBus(() => {});
    const listener = vi.fn();
    bus.once(TabActivated, listener);
    bus.emit(TabActivated, { tabId: 'a' });
    bus.emit(TabActivated, { tabId: 'b' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('isolates failing listeners and reports them with the event type', () => {
    const onError = vi.fn();
    const bus = new EventBus(onError);
    const healthy = vi.fn();
    bus.on(TabActivated, () => {
      throw new Error('broken');
    });
    bus.on(TabActivated, healthy);
    bus.emit(TabActivated, { tabId: 'a' });
    expect(healthy).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(new Error('broken'), TabActivated);
  });

  it('drops all subscriptions on dispose', () => {
    const bus = new EventBus(() => {});
    const listener = vi.fn();
    bus.on(TabActivated, listener);
    bus.dispose();
    bus.emit(TabActivated, { tabId: 'a' });
    expect(listener).not.toHaveBeenCalled();
  });
});
