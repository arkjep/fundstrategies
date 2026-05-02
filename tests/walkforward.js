// Walk-forward / out-of-sample harness for the apex strategy.
//
// Usage: node tests/walkforward.js
//
// Produces:
//   1. Per-calendar-year out-of-sample stats for the default apex parameters,
//      so you can see whether the headline CAGR is broad-based or driven by
//      a few outlier years.
//   2. A parameter sensitivity sweep showing how stable apex is to its
//      hyperparameter choices. If small parameter changes produce wildly
//      different results, the strategy is overfit and the headline number
//      should not be trusted.

const path = require('node:path');
const { getHistorySeries } = require('../src/services/historyService');
const { STRATEGY_CONFIG, runBacktest } = require('../src/backtest/engine');

const STRATEGY = 'apex';
const TICKERS = STRATEGY_CONFIG[STRATEGY].tickers;

async function loadAllSeries() {
  const byTicker = {};
  for (const tk of TICKERS) {
    try {
      byTicker[tk] = await getHistorySeries(`${tk}.us`);
    } catch (err) {
      console.warn(`! could not load ${tk}: ${err.message}`);
    }
  }
  return byTicker;
}

function runWindow(byTicker, startDate, endDate, strategyParams) {
  const fetchStart = new Date(startDate);
  fetchStart.setDate(fetchStart.getDate() - Math.ceil(STRATEGY_CONFIG[STRATEGY].lookback * 1.4));
  return runBacktest({
    strategy: STRATEGY,
    byTicker,
    startDate: fetchStart,
    analysisStartDate: startDate,
    endDate,
    executionMode: 'close',
    strategyParams,
  });
}

function pct(x) { return (x * 100).toFixed(1) + '%'; }

function summarize(label, results) {
  const rets = results.map((r) => r.cagr).filter((x) => Number.isFinite(x));
  if (rets.length === 0) {
    console.log(`${label}: no data`);
    return;
  }
  const sorted = [...rets].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const positive = rets.filter((x) => x > 0).length;
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  console.log(
    `${label}  mean=${pct(mean)}  median=${pct(median)}  worst=${pct(worst)}  best=${pct(best)}  positive=${positive}/${rets.length}`,
  );
}

async function yearlyOutOfSample(byTicker) {
  console.log('\n=== Yearly out-of-sample (default params) ===');
  console.log('Year   CAGR    MDD     Trades');
  const results = [];
  // Earliest year where enough leveraged ETFs exist + 252 warmup is ~2011.
  for (let year = 2011; year <= 2024; year += 1) {
    const start = new Date(`${year}-01-01`);
    const end = new Date(`${year}-12-31`);
    try {
      const r = runWindow(byTicker, start, end);
      const eq = r.equity.filter((v) => Number.isFinite(v));
      if (eq.length < 50) {
        console.log(`${year}   (insufficient data)`);
        continue;
      }
      const cagr = r.stats.annualizedReturn;
      const mdd = r.stats.maxDrawdown;
      console.log(`${year}   ${pct(cagr).padStart(7)}  ${pct(mdd).padStart(7)}  ${r.tradeLog.length}`);
      results.push({ year, cagr, mdd });
    } catch (err) {
      console.log(`${year}   ERR ${err.message}`);
    }
  }
  summarize('All years', results);
  return results;
}

async function parameterSweep(byTicker) {
  console.log('\n=== Parameter sensitivity (full window 2011-2024) ===');
  console.log('lookback  targetVol  regimeLow  CAGR    MDD     totalX');

  const grid = [];
  for (const lookback of [42, 63, 90, 126]) {
    for (const targetVol of [0.40, 0.55, 0.70, 0.85]) {
      for (const regimeLow of [0.3, 0.4, 0.5]) {
        grid.push({ lookback, targetVol, regimeLow, regimeHigh: 0.8 });
      }
    }
  }

  const start = new Date('2011-01-01');
  const end = new Date('2024-12-31');
  const all = [];
  for (const params of grid) {
    try {
      const r = runWindow(byTicker, start, end, params);
      const eq = r.equity.filter((v) => Number.isFinite(v));
      const totalX = eq.length > 1 ? eq[eq.length - 1] / eq[0] : 0;
      const cagr = r.stats.annualizedReturn;
      const mdd = r.stats.maxDrawdown;
      console.log(
        `   ${String(params.lookback).padStart(3)}     ${params.targetVol.toFixed(2)}      ${params.regimeLow.toFixed(2)}    ${pct(cagr).padStart(7)}  ${pct(mdd).padStart(7)}  ${totalX.toFixed(2)}`,
      );
      all.push({ ...params, cagr, mdd, totalX });
    } catch (err) {
      console.log(`   ${params.lookback} ${params.targetVol} ${params.regimeLow}  ERR ${err.message}`);
    }
  }

  const cagrs = all.map((x) => x.cagr).filter((x) => Number.isFinite(x));
  if (cagrs.length > 0) {
    const sorted = [...cagrs].sort((a, b) => a - b);
    const mean = cagrs.reduce((s, x) => s + x, 0) / cagrs.length;
    const std = Math.sqrt(cagrs.reduce((s, x) => s + (x - mean) ** 2, 0) / cagrs.length);
    console.log(
      `\n  ${cagrs.length} parameter sets: CAGR mean=${pct(mean)}  std=${pct(std)}  min=${pct(sorted[0])}  max=${pct(sorted[sorted.length - 1])}`,
    );
    console.log(
      `  std/mean = ${(std / Math.abs(mean)).toFixed(2)} (lower = more robust; > 0.5 suggests overfit)`,
    );
  }
}

async function rollingTrainTest(byTicker) {
  console.log('\n=== Rolling 3y train -> 1y test (parameter selection by training Sharpe) ===');
  console.log('Train -> Test          BestParams                    TestCAGR  TestMDD');

  const grid = [];
  for (const lookback of [42, 63, 90]) {
    for (const targetVol of [0.40, 0.55, 0.70]) {
      grid.push({ lookback, targetVol, regimeLow: 0.4, regimeHigh: 0.8 });
    }
  }

  const testResults = [];
  for (let year = 2014; year <= 2024; year += 1) {
    const trainStart = new Date(`${year - 3}-01-01`);
    const trainEnd = new Date(`${year - 1}-12-31`);
    const testStart = new Date(`${year}-01-01`);
    const testEnd = new Date(`${year}-12-31`);

    let bestParams = null;
    let bestSharpe = -Infinity;
    for (const params of grid) {
      try {
        const r = runWindow(byTicker, trainStart, trainEnd, params);
        const sh = r.stats.sharpe;
        if (Number.isFinite(sh) && sh > bestSharpe) {
          bestSharpe = sh;
          bestParams = params;
        }
      } catch { /* ignore */ }
    }

    if (!bestParams) {
      console.log(`${year}  no train result`);
      continue;
    }

    try {
      const r = runWindow(byTicker, testStart, testEnd, bestParams);
      const eq = r.equity.filter((v) => Number.isFinite(v));
      if (eq.length < 50) continue;
      const cagr = r.stats.annualizedReturn;
      const mdd = r.stats.maxDrawdown;
      const tag = `lb=${bestParams.lookback} vol=${bestParams.targetVol}`;
      console.log(`${year - 3}-${year - 1} -> ${year}   ${tag.padEnd(28)}   ${pct(cagr).padStart(7)}  ${pct(mdd).padStart(7)}`);
      testResults.push({ year, cagr, mdd });
    } catch (err) {
      console.log(`${year} test ERR ${err.message}`);
    }
  }
  summarize('Walk-forward OOS', testResults);
}

(async () => {
  console.log(`Loading ${TICKERS.length} tickers from cache (${path.join(process.cwd(), 'cache')})...`);
  const byTicker = await loadAllSeries();
  console.log(`Loaded: ${Object.keys(byTicker).join(', ')}`);

  await yearlyOutOfSample(byTicker);
  await parameterSweep(byTicker);
  await rollingTrainTest(byTicker);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
