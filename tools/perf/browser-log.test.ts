import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { updateServiceStates } from './browser-log.ts';

const record = (message: string, fields?: Record<string, string>): string =>
  JSON.stringify({ time: 1, level: 'info', scope: 'main', message, fields });

describe('updateServiceStates', () => {
  it('returns the state of every update service start in order', () => {
    const log = [
      record('Starting'),
      record('Update service', { installType: 'mac', state: 'disabled' }),
      record('No update available'),
      record('Update service', { installType: 'nsis', state: 'idle' }),
    ].join('\n');
    assert.deepEqual(updateServiceStates(log), ['disabled', 'idle']);
  });

  it('skips empty and unfinished lines and records without a state', () => {
    const log = ['', record('Update service'), '{"time":2,"level":"info","mess', ''].join('\n');
    assert.deepEqual(updateServiceStates(log), []);
  });
});
