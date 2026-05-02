const test = require('node:test');
const assert = require('node:assert/strict');

const { STRATEGY_CONFIG, runBacktest } = require('../src/backtest/engine');

test('all strategies enforce one-bar signal lag', () => {
  const synthetic = buildSyntheticTickerData(420);
  const fetchStartDate = new Date('2010-01-01');
  const startDate = new Date('2010-08-01');
  const endDate = new Date('2011-12-31');

  for (const strategy of Object.keys(STRATEGY_CONFIG)) {
    const result = runBacktest({
      strategy,
      byTicker: synthetic,
      startDate: fetchStartDate,
      analysisStartDate: startDate,
      endDate,
      executionMode: 'close',
    });

    assert.ok(Array.isArray(result.causalityTrace));
    assert.ok(result.causalityTrace.length > 0, `${strategy} should emit causality trace rows`);

    for (const row of result.causalityTrace) {
      assert.equal(row.returnIndex, row.signalIndex + 1, `${strategy} violated one-bar lag`);
      assert.ok(row.signalDate < row.returnDate, `${strategy} signal date must be before return date`);
    }
  }
});

function buildSyntheticTickerData(length) {
  const allTickers = new Set();
  for (const strategy of Object.values(STRATEGY_CONFIG)) {
    for (const tk of strategy.tickers) allTickers.add(tk);
  }

  const byTicker = {};
  let idx = 0;
  for (const tk of allTickers) {
    const slope = 0.0008 + (idx % 7) * 0.0001;
    const wave = 0.004 + (idx % 3) * 0.001;
    byTicker[tk] = makeSeries(length, slope, wave);
    idx += 1;
  }

  return byTicker;
}

function makeSeries(length, slope, waveSize) {
  const out = [];
  let close = 100;

  for (let i = 0; i < length; i += 1) {
    const date = new Date(Date.UTC(2010, 0, 1 + i));
    const cycle = Math.sin(i / 9) * waveSize;
    const drift = slope;

    const open = close * (1 + cycle / 2);
    close = Math.max(1, close * (1 + drift + cycle));

    out.push({
      date,
      open,
      close,
      vol: 15_000_000 + (i % 10) * 200_000,
    });
  }

  return out;
}
