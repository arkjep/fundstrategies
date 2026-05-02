// Year-by-year comparison: tempest vs apex.
const { getHistorySeries } = require('../src/services/historyService');
const { STRATEGY_CONFIG, runBacktest } = require('../src/backtest/engine');

async function loadTickers(tickers) {
  const byTicker = {};
  for (const tk of tickers) {
    try { byTicker[tk] = await getHistorySeries(`${tk}.us`); } catch (e) { /* skip */ }
  }
  return byTicker;
}

function runYear(strategy, byTicker, year) {
  const start = new Date(`${year}-01-01`);
  const end = new Date(`${year}-12-31`);
  const fetchStart = new Date(start);
  fetchStart.setDate(fetchStart.getDate() - 400);
  return runBacktest({
    strategy, byTicker,
    startDate: fetchStart,
    analysisStartDate: start,
    endDate: end,
    executionMode: 'close',
  });
}

function pct(x) { return (x * 100).toFixed(1) + '%'; }

(async () => {
  const allTickers = Array.from(new Set([
    ...STRATEGY_CONFIG.apex.tickers,
    ...STRATEGY_CONFIG.tempest.tickers,
  ]));
  console.log(`Loading ${allTickers.length} tickers...`);
  const byTicker = await loadTickers(allTickers);
  console.log(`Loaded ${Object.keys(byTicker).length}\n`);

  console.log('Year   Apex CAGR  Apex MDD   Tempest CAGR  Tempest MDD   Tempest-Apex');
  const rows = [];
  for (let y = 2013; y <= 2025; y += 1) {
    let aCagr = NaN, aMdd = NaN, tCagr = NaN, tMdd = NaN;
    try { const r = runYear('apex', byTicker, y); aCagr = r.stats.annualizedReturn; aMdd = r.stats.maxDrawdown; } catch {}
    try { const r = runYear('tempest', byTicker, y); tCagr = r.stats.annualizedReturn; tMdd = r.stats.maxDrawdown; } catch {}
    const delta = (Number.isFinite(aCagr) && Number.isFinite(tCagr)) ? tCagr - aCagr : NaN;
    console.log(
      `${y}   ${pct(aCagr).padStart(8)}   ${pct(aMdd).padStart(8)}    ${pct(tCagr).padStart(8)}     ${pct(tMdd).padStart(8)}      ${Number.isFinite(delta) ? pct(delta).padStart(7) : '   n/a'}`,
    );
    if (Number.isFinite(aCagr) && Number.isFinite(tCagr)) rows.push({ y, aCagr, tCagr });
  }

  if (rows.length) {
    const meanA = rows.reduce((s, r) => s + r.aCagr, 0) / rows.length;
    const meanT = rows.reduce((s, r) => s + r.tCagr, 0) / rows.length;
    const winsT = rows.filter((r) => r.tCagr > r.aCagr).length;
    console.log(`\nMean: apex=${pct(meanA)}  tempest=${pct(meanT)}  tempest beats apex in ${winsT}/${rows.length} years`);
  }

  console.log('\n=== Full window 2012-2025 ===');
  for (const strat of ['apex', 'tempest']) {
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
      console.log(`${strat.padEnd(8)}  CAGR=${pct(r.stats.annualizedReturn)}  MDD=${pct(r.stats.maxDrawdown)}  Sharpe=${r.stats.sharpe.toFixed(2)}  ${totalX.toFixed(2)}x`);
    } catch (e) { console.log(strat, 'ERR', e.message); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
