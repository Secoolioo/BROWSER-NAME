import { describe, expect, it, vi } from 'vitest';
import { DisposableStore, isDisposable, toDisposable } from '../disposable.ts';
import { err, ok } from '../result.ts';

describe('toDisposable', () => {
  it('runs the cleanup once', () => {
    const cleanup = vi.fn();
    const disposable = toDisposable(cleanup);
    disposable.dispose();
    disposable.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('DisposableStore', () => {
  it('disposes items in reverse order', () => {
    const calls: string[] = [];
    const store = new DisposableStore();
    store.add(toDisposable(() => calls.push('a')));
    store.add(toDisposable(() => calls.push('b')));
    store.dispose();
    expect(calls).toEqual(['b', 'a']);
    expect(store.isDisposed).toBe(true);
  });

  it('disposes items added after disposal immediately', () => {
    const store = new DisposableStore();
    store.dispose();
    const cleanup = vi.fn();
    store.add(toDisposable(cleanup));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('disposes every item even if one throws, then reports all errors', () => {
    const store = new DisposableStore();
    const later = vi.fn();
    store.add(toDisposable(later));
    store.add(
      toDisposable(() => {
        throw new Error('boom');
      }),
    );
    expect(() => store.dispose()).toThrow(AggregateError);
    expect(later).toHaveBeenCalledOnce();
    expect(() => store.dispose()).not.toThrow();
  });
});

describe('isDisposable', () => {
  it('detects objects with a dispose method', () => {
    expect(isDisposable({ dispose: () => {} })).toBe(true);
    expect(isDisposable({ dispose: 1 })).toBe(false);
    expect(isDisposable(null)).toBe(false);
    expect(isDisposable('x')).toBe(false);
  });
});

describe('Result', () => {
  it('creates ok and error results', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('no')).toEqual({ ok: false, error: 'no' });
  });
});
