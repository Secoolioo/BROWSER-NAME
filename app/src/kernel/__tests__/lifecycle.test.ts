import { describe, expect, it, vi } from 'vitest';
import { Lifecycle } from '../lifecycle/lifecycle.ts';
import { RingBufferLogSink, SinkLogger } from '../logging/logger.ts';
import { ManualClock } from '../time/clock.ts';

function setup(timeoutMs = 100): {
  lifecycle: Lifecycle;
  clock: ManualClock;
  sink: RingBufferLogSink;
} {
  const clock = new ManualClock();
  const sink = new RingBufferLogSink();
  const logger = new SinkLogger(sink, clock, { scope: 'test', level: 'trace' });
  return { lifecycle: new Lifecycle(logger, clock, { shutdownTimeoutMs: timeoutMs }), clock, sink };
}

describe('Lifecycle', () => {
  it('moves forward through the phases and notifies listeners', async () => {
    const { lifecycle } = setup();
    const phases: string[] = [];
    lifecycle.onDidChangePhase((phase) => phases.push(phase));
    const ready = lifecycle.when('ready');
    lifecycle.advance('ready');
    await ready;
    lifecycle.advance('running');
    await lifecycle.when('starting');
    expect(lifecycle.phase).toBe('running');
    expect(phases).toEqual(['ready', 'running']);
  });

  it('rejects moving backwards', () => {
    const { lifecycle } = setup();
    lifecycle.advance('running');
    expect(() => lifecycle.advance('ready')).toThrow('Cannot move from running to ready');
  });

  it('waits for joined work before stopping', async () => {
    const { lifecycle } = setup();
    const { promise: work, resolve: finish } = Promise.withResolvers<void>();
    lifecycle.onWillShutdown((event) => event.join(work, 'save session'));
    const done = lifecycle.shutdown('quit');
    expect(lifecycle.shutdown('quit')).toBe(done);
    expect(lifecycle.phase).toBe('shutting-down');
    finish();
    await done;
    expect(lifecycle.phase).toBe('stopped');
  });

  it('stops after the timeout when work hangs and logs it', async () => {
    const { lifecycle, clock, sink } = setup(100);
    lifecycle.onWillShutdown((event) => event.join(new Promise(() => {}), 'stuck'));
    const done = lifecycle.shutdown('update');
    clock.advance(100);
    await done;
    expect(lifecycle.phase).toBe('stopped');
    expect(sink.records.map((r) => r.message)).toContain('Shutdown timed out');
  });

  it('logs failed work and failing listeners without blocking shutdown', async () => {
    const { lifecycle, sink } = setup();
    lifecycle.onWillShutdown((event) => event.join(Promise.reject(new Error('disk')), 'flush'));
    lifecycle.onWillShutdown(() => {
      throw new Error('listener');
    });
    await lifecycle.shutdown('restart');
    expect(lifecycle.phase).toBe('stopped');
    const messages = sink.records.map((r) => r.message);
    expect(messages).toContain('Shutdown work failed: flush');
    expect(messages).toContain('Shutdown listener failed');
  });

  it('removes listeners on dispose', () => {
    const { lifecycle } = setup();
    const listener = vi.fn();
    lifecycle.onDidChangePhase(listener);
    lifecycle.dispose();
    lifecycle.advance('ready');
    expect(listener).not.toHaveBeenCalled();
  });
});
