import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mannWhitneyGreater, median, normalCdf } from './stats.ts';

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), 0);
  });
});

describe('normalCdf', () => {
  it('matches known values of the standard normal distribution', () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
    assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
    assert.ok(Math.abs(normalCdf(-2.326) - 0.01) < 1e-4);
  });
});

describe('mannWhitneyGreater', () => {
  const base = Array.from({ length: 20 }, (_, i) => 500 + i * 5);

  it('is significant when every sample of a is larger', () => {
    assert.ok(
      mannWhitneyGreater(
        base.map((v) => v + 200),
        base,
      ) < 0.001,
    );
  });

  it('is not significant for identical distributions', () => {
    assert.ok(mannWhitneyGreater(base, base) > 0.4);
  });

  it('is not significant for a small shift within the spread', () => {
    assert.ok(
      mannWhitneyGreater(
        base.map((v) => v + 10),
        base,
      ) > 0.01,
    );
  });

  it('treats ties and empty groups safely', () => {
    assert.equal(mannWhitneyGreater([1, 1, 1], [1, 1, 1]), 1);
    assert.equal(mannWhitneyGreater([], [1]), 1);
  });
});
