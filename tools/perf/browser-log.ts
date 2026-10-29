/**
 * Reads the log of the browser under test: JSON Lines with one record per line, as
 * `app/src/platform/node/file-log-sink.ts` writes them.
 */

/**
 * Returns the state that the update service reported each time it started, such as
 * `disabled` or `idle`, in the order of the log.
 * @param log - Contents of one or more log files.
 */
export function updateServiceStates(log: string): string[] {
  const states: string[] = [];
  for (const line of log.split('\n')) {
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      // Empty lines, and a line that a stopped browser could not finish.
      continue;
    }
    if (typeof record !== 'object' || record === null) continue;
    const { message, fields } = record as { message?: unknown; fields?: { state?: unknown } };
    if (message === 'Update service' && typeof fields?.state === 'string') {
      states.push(fields.state);
    }
  }
  return states;
}
