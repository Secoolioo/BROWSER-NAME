import { describe, expect, it, vi } from 'vitest';
import { FanOutLogSink, RingBufferLogSink, SinkLogger, describeError } from '../logging/logger.ts';
import { ManualClock } from '../time/clock.ts';

describe('SinkLogger', () => {
  it('filters by level and writes structured records', () => {
    const sink = new RingBufferLogSink();
    const logger = new SinkLogger(sink, new ManualClock(5, 1000), { scope: 'kernel' });
    logger.debug('hidden');
    logger.info('shown', { tabs: 3 });
    logger.warn('careful');
    logger.trace('hidden too');
    expect(logger.isEnabled('debug')).toBe(false);
    expect(sink.records).toEqual([
      { time: 1005, level: 'info', scope: 'kernel', message: 'shown', fields: { tabs: 3 } },
      { time: 1005, level: 'warn', scope: 'kernel', message: 'careful' },
    ]);
  });

  it('creates child scopes on the same sink', () => {
    const sink = new RingBufferLogSink();
    const logger = new SinkLogger(sink, new ManualClock(), { scope: 'a', level: 'trace' });
    logger.child('b').trace('x');
    logger.child('c').debug('y');
    expect(sink.records.map((r) => `${r.scope}:${r.level}`)).toEqual(['a.b:trace', 'a.c:debug']);
  });

  it('serializes errors and non-errors', () => {
    const sink = new RingBufferLogSink();
    const logger = new SinkLogger(sink, new ManualClock(), { scope: 's' });
    logger.error('failed', new TypeError('bad'));
    logger.error('failed', 'text');
    expect(sink.records[0]?.error).toMatchObject({ name: 'TypeError', message: 'bad' });
    expect(sink.records[1]?.error).toEqual({ name: 'NonError', message: 'text' });
    const noStack = new Error('x');
    delete noStack.stack;
    expect(describeError(noStack)).toEqual({ name: 'Error', message: 'x' });
  });
});

describe('log sinks', () => {
  it('keeps only the newest records', () => {
    const sink = new RingBufferLogSink(2);
    const logger = new SinkLogger(sink, new ManualClock(), { scope: 's' });
    logger.info('1');
    logger.info('2');
    logger.info('3');
    expect(sink.records.map((r) => r.message)).toEqual(['2', '3']);
  });

  it('fans out to every sink', () => {
    const a = { write: vi.fn() };
    const b = { write: vi.fn() };
    new SinkLogger(new FanOutLogSink([a, b]), new ManualClock(), { scope: 's' }).info('m');
    expect(a.write).toHaveBeenCalledOnce();
    expect(b.write).toHaveBeenCalledOnce();
  });
});

describe('ManualClock', () => {
  it('runs due timers in order and skips cancelled ones', () => {
    const clock = new ManualClock(0, 100);
    const calls: string[] = [];
    clock.setTimeout(() => calls.push(`b@${clock.now()}`), 20);
    clock.setTimeout(() => calls.push(`a@${clock.now()}`), 10);
    clock.setTimeout(() => calls.push('never'), 15).dispose();
    clock.setTimeout(() => calls.push('later'), 50);
    clock.advance(30);
    expect(calls).toEqual(['a@10', 'b@20']);
    expect(clock.now()).toBe(30);
    expect(clock.wallTime()).toBe(130);
    expect(clock.pendingTimers).toBe(1);
  });

  it('runs timers scheduled by other timers when they fall in the window', () => {
    const clock = new ManualClock();
    const calls: number[] = [];
    clock.setTimeout(() => {
      calls.push(clock.now());
      clock.setTimeout(() => calls.push(clock.now()), 5);
    }, 5);
    clock.advance(10);
    expect(calls).toEqual([5, 10]);
  });
});
