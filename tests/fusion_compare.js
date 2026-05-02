const { getHistorySeries } = require('../src/services/historyService');
const { STRATEGY_CONFIG, runBacktest } = require('../src/backtest/engine');

async function loadTickers(tickers) {
  const out = {};
  for (const tk of tickers) { try { out[tk] = await getHistorySeries(`${tk}.us`); } catch {} }
  return out;
}

function runYear(strategy, byTicker, year) {
  const start = new Date(`${year}-01-01`);
  const end = new Date(`${year}-12-31`);
  const fetchStart = new Date(start); fetchStart.setDate(fetchStart.getDate() - 400);
  return runBacktest({ strategy, byTicker, startDate: fetchStart, analysisStartDate: start, endDate: end, executionMode: 'close' });
}

function pct(x) { return (x * 100).toFixed(1) + '%'; }

(async () => {
  const all = Array.from(new Set([
    ...STRATEGY_CONFIG.apex.tickers,
    ...STRATEGY_CONFIG.tempest.tickers,
    ...STRATEGY_CONFIG.fusion.tickers,
  ]));
  console.log(`Loading ${all.length} tickers...`);
  const byTicker = await loadTickers(all);
  console.log(`Loaded ${Object.keys(byTicker).length}\n`);

  const strats = ['apex', 'tempest', 'fusion'];

  console.log('Year    Apex      Tempest   Fusion');
  const rows = { apex: [], tempest: [], fusion: [] };
  for (let y = 2013; y <= 2025; y += 1) {
    const cells = strats.map((s) => {
      try { const r = runYear(s, byTicker, y); rows[s].push(r.stats.annualizedReturn); return pct(r.stats.annualizedReturn).padStart(8); }
      catch { return '   ERR'.padStart(8); }
    });
    console.log(`${y}   ${cells.join('  ')}`);
  }
  console.log();
  for (const s of strats) {
    const arr = rows[s];
    if (!arr.length) continue;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sorted = [...arr].sort((a, b) => a - b);
    const positive = arr.filter((x) => x > 0).length;
    console.log(`${s.padEnd(8)} mean=${pct(mean)}  worst=${pct(sorted[0])}  best=${pct(sorted[sorted.length - 1])}  positive=${positive}/${arr.length}`);
  }

  console.log('\n=== Full window 2012-2025 ===');
  for (const strat of strats) {
    try {
      const r = runBacktest({
        strategy: strat, byTicker,
        startDate: new Date('2010-01-01'),
        analysisStartDate: new Date('2012-01-01'),
        endDate: new Date('2025-12-31'),
        executionMode: 'close',
      });
      const eq = r.equity.filter((v) => Number.isFinite(v));
      const totalX = eq.length > 1 ? eq[eq.length - 1] / eq[0] : 0;
      console.log(`${strat.padEnd(8)}  CAGR=${pct(r.stats.annualizedReturn)}  MDD=${pct(r.stats.maxDrawdown)}  Sharpe=${r.stats.sharpe.toFixed(2)}  Calmar=${r.stats.calmar.toFixed(2)}  ${totalX.toFixed(2)}x`);
    } catch (e) { console.log(strat, 'ERR', e.message); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
