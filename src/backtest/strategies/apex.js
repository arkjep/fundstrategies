const { sma, stdev, correlation, avgDollarVol } = require('../indicators');

// APEX — Aggressive growth strategy.
//
// Goals:
//   * Concentrate in the strongest leveraged ETFs during clear bull regimes.
//   * Step down hard (cash + gold) when the regime weakens.
//   * Vol-target the risky basket so leveraged-ETF decay does not blow up
//     drawdowns when realized vol spikes.
//   * Avoid loading the basket with two highly-correlated names
//     (e.g. SOXL + TQQQ).
//
// Backtest (close-to-close, executed t+1, full data):
//   2010-2024  ~21% CAGR, ~52% MDD, ~18x growth
//   2015-2024  ~22% CAGR, ~50% MDD,  ~9x growth
//
// This is the highest-growth rule we have validated using only the assets
// in cache/. It is NOT close to 100% CAGR — sustained 100%+ is not
// realistic from a long-only ETF rotation.

function signalApex(ctx) {
  const sigI = ctx.signalIndex;
  const series = ctx.series;
  const priceKey = ctx.executionMode === 'close' ? 'close' : 'open';

  const params = ctx.state.apexParams || {};
  const LOOKBACK = params.lookback ?? 63;
  const TARGET_VOL = params.targetVol ?? 0.55;
  const REGIME_LOW = params.regimeLow ?? 0.4;
  const REGIME_HIGH = params.regimeHigh ?? 0.8;
  const MIN_GROSS = params.minGross ?? 0.25;
  const CORR_CAP = params.corrCap ?? 0.92;
  const VOL_SPIKE_MULT = params.volSpikeMult ?? 1.4;
  const BEAR_ENABLED = params.bearEnabled ?? false;
  const BEAR_TARGET_VOL = params.bearTargetVol ?? 0.35;
  const BEAR_MAX_GROSS = params.bearMaxGross ?? 0.5;
  const BEAR_LOOKBACK = params.bearLookback ?? 42;

  if (sigI < 252) return { ready: false, allocation: {}, extras: {} };
  if (!series.spy || !series.qqq || !series.iwm || !series.shy) {
    return { ready: false, allocation: {}, extras: {} };
  }

  const spy = series.spy;
  const qqq = series.qqq;
  const iwm = series.iwm;
  const spyPx = spy[sigI][priceKey];

  const checks = [];
  checks.push(spyPx > sma(spy, sigI, 200));
  checks.push(spyPx > sma(spy, sigI, 50));
  checks.push(spy[sigI].close / spy[sigI - 126].close > 1.0);

  let breadth = 0;
  for (const s of [spy, qqq, iwm]) {
    if (s[sigI][priceKey] > sma(s, sigI, 200)) breadth += 1;
  }
  checks.push(breadth >= 2);

  const vol20 = stdev(spy, sigI, 20);
  const vol252 = stdev(spy, sigI, 252);
  checks.push(vol252 > 0 && vol20 < vol252 * VOL_SPIKE_MULT);

  const score = checks.filter(Boolean).length / checks.length;

  if (score < REGIME_LOW) {
    if (BEAR_ENABLED) {
      const bear = pickBear(ctx, sigI, BEAR_LOOKBACK, BEAR_TARGET_VOL, BEAR_MAX_GROSS, CORR_CAP);
      if (bear) return { ready: true, allocation: bear.allocation, extras: { riskOn: false, score, bear: true, picks: bear.picks } };
    }
    const allocation = series.gld ? { shy: 0.6, gld: 0.4 } : { shy: 1.0 };
    return { ready: true, allocation, extras: { riskOn: false, score } };
  }

  const universe = ctx.state.apexUniverse || [];
  const lookback = LOOKBACK;
  const liqThresh = 5e6;

  const ranked = universe
    .filter((tk) => {
      const s = series[tk];
      if (!s || !s[sigI] || !s[sigI - lookback]) return false;
      const a = s[sigI - lookback].close;
      const b = s[sigI].close;
      return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0;
    })
    .filter((tk) => avgDollarVol(series[tk], sigI, 20) > liqThresh)
    .map((tk) => ({
      tk,
      mom: series[tk][sigI].close / series[tk][sigI - lookback].close - 1,
    }))
    .filter((r) => r.mom > 0)
    .sort((a, b) => b.mom - a.mom);

  if (ranked.length === 0) {
    const allocation = series.gld ? { shy: 0.6, gld: 0.4 } : { shy: 1.0 };
    return { ready: true, allocation, extras: { riskOn: false, score } };
  }

  // Correlation-aware top-N (more names when conviction is highest).
  const targetN = score >= REGIME_HIGH ? 3 : 2;
  const corrLookback = 60;
  const corrCap = CORR_CAP;
  const picked = [];

  for (const cand of ranked) {
    if (picked.length >= targetN) break;
    let ok = true;
    for (const p of picked) {
      const c = correlation(series[cand.tk], series[p.tk], sigI, corrLookback);
      if (c > corrCap) { ok = false; break; }
    }
    if (ok) picked.push(cand);
  }
  if (picked.length === 0) picked.push(ranked[0]);

  let volSum = 0;
  let volN = 0;
  for (const p of picked) {
    const v = stdev(series[p.tk], sigI, 20);
    if (Number.isFinite(v) && v > 0) { volSum += v; volN += 1; }
  }
  const basketAnnVol = volN ? (volSum / volN) * Math.sqrt(252) : 0;
  const targetVol = TARGET_VOL;
  const volScale = basketAnnVol > 0 ? Math.min(targetVol / basketAnnVol, 1.0) : 1.0;

  const regimeThrottle = Math.max(0, Math.min(1, (score - REGIME_LOW) / (REGIME_HIGH - REGIME_LOW)));

  const grossExposure = Math.max(MIN_GROSS, Math.min(1, volScale * regimeThrottle));
  const perName = grossExposure / picked.length;

  const allocation = {};
  for (const p of picked) allocation[p.tk] = perName;

  const cashWeight = Math.max(0, 1 - grossExposure);
  if (cashWeight > 0.001) allocation.shy = cashWeight;

  return { ready: true, allocation, extras: { riskOn: true, score } };
}

function pickBear(ctx, sigI, lookback, targetVol, maxGross, corrCap) {
  const series = ctx.series;
  const universe = ctx.state.apexBearUniverse || [];
  const liqThresh = 5e6;

  const ranked = universe
    .filter((tk) => {
      const s = series[tk];
      if (!s || !s[sigI] || !s[sigI - lookback]) return false;
      const a = s[sigI - lookback].close;
      const b = s[sigI].close;
      return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0;
    })
    .filter((tk) => avgDollarVol(series[tk], sigI, 20) > liqThresh)
    .map((tk) => ({
      tk,
      mom: series[tk][sigI].close / series[tk][sigI - lookback].close - 1,
    }))
    .filter((r) => r.mom > 0)
    .sort((a, b) => b.mom - a.mom);

  if (ranked.length === 0) return null;

  const targetN = Math.min(2, ranked.length);
  const picked = [];
  for (const cand of ranked) {
    if (picked.length >= targetN) break;
    let ok = true;
    for (const p of picked) {
      const c = correlation(series[cand.tk], series[p.tk], sigI, 60);
      if (c > corrCap) { ok = false; break; }
    }
    if (ok) picked.push(cand);
  }
  if (picked.length === 0) picked.push(ranked[0]);

  let volSum = 0;
  let volN = 0;
  for (const p of picked) {
    const v = stdev(series[p.tk], sigI, 20);
    if (Number.isFinite(v) && v > 0) { volSum += v; volN += 1; }
  }
  const basketAnnVol = volN ? (volSum / volN) * Math.sqrt(252) : 0;
  const volScale = basketAnnVol > 0 ? Math.min(targetVol / basketAnnVol, 1.0) : 1.0;
  const grossExposure = Math.min(maxGross, volScale);

  const perName = grossExposure / picked.length;
  const allocation = {};
  for (const p of picked) allocation[p.tk] = perName;
  const cashWeight = Math.max(0, 1 - grossExposure);
  if (cashWeight > 0.001) {
    if (series.gld) {
      allocation.shy = cashWeight * 0.7;
      allocation.gld = cashWeight * 0.3;
    } else {
      allocation.shy = cashWeight;
    }
  }
  return { allocation, picks: picked.map((p) => p.tk) };
}

module.exports = {
  signalApex,
};
