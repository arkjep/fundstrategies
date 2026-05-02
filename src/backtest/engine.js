const { STRATEGY_CONFIG, computeSignal, buildStrategyState } = require('./strategies');

function runBacktest({ strategy, byTicker, startDate, analysisStartDate, endDate, executionMode }) {
  if (!STRATEGY_CONFIG[strategy]) {
    throw new Error(`Unknown strategy: ${strategy}`);
  }

  const normalizedByTicker = {};
  for (const tk of STRATEGY_CONFIG[strategy].tickers) {
    if (byTicker[tk]) {
      normalizedByTicker[tk] = sliceByDate(byTicker[tk], startDate, endDate);
    }
  }

  if (strategy === 'turbo') {
    for (const tk of Object.keys(normalizedByTicker)) {
      if (normalizedByTicker[tk].length < 250) {
        delete normalizedByTicker[tk];
      }
    }
  }

  let apexAdvancedStart = null;
  if (strategy === 'apex') {
    const required = new Set(['spy', 'qqq', 'iwm', 'shy', 'gld']);
    let cutoff = analysisStartDate || startDate;

    const buildSet = (effectiveCutoff) => {
      const out = {};
      for (const tk of STRATEGY_CONFIG.apex.tickers) {
        if (!byTicker[tk]) continue;
        const arr = sliceByDate(byTicker[tk], startDate, endDate);
        if (arr.length < 250) continue;
        if (!required.has(tk) && arr[0].date > effectiveCutoff) continue;
        out[tk] = arr;
      }
      return out;
    };

    let working = buildSet(cutoff);
    let candidates = Object.keys(working).filter((tk) => !required.has(tk));

    // If the chosen window is too early to contain enough leveraged ETFs,
    // auto-advance the analysis start so the strategy actually has something
    // to rotate into instead of sitting in SHY/GLD forever.
    const minCandidates = 4;
    if (candidates.length < minCandidates) {
      const inceptions = STRATEGY_CONFIG.apex.tickers
        .filter((tk) => !required.has(tk) && byTicker[tk] && byTicker[tk].length >= 250)
        .map((tk) => byTicker[tk][0].date)
        .sort((a, b) => a - b);
      if (inceptions.length >= minCandidates) {
        cutoff = inceptions[minCandidates - 1];
        // ~252 trading days ≈ 366 calendar days of warmup before signals fire.
        apexAdvancedStart = new Date(cutoff.getTime() + 366 * 24 * 60 * 60 * 1000);
        working = buildSet(cutoff);
      }
    }

    for (const tk of Object.keys(normalizedByTicker)) delete normalizedByTicker[tk];
    Object.assign(normalizedByTicker, working);
  }

  const aligned = alignSeries(normalizedByTicker);
  if (aligned.dates.length < 3) {
    throw new Error('Not enough aligned data to run backtest');
  }

  const effectiveAnalysisStart = (() => {
    const base = analysisStartDate || startDate;
    if (apexAdvancedStart && apexAdvancedStart > base) return apexAdvancedStart;
    return base;
  })();
  const userStartIndex = aligned.dates.findIndex((date) => date >= effectiveAnalysisStart);
  if (userStartIndex < 0) {
    throw new Error('Start date is outside available aligned data');
  }

  const state = buildStrategyState(strategy, aligned.series);
  const result = runCausalSimulation({
    strategy,
    aligned,
    state,
    userStartIndex,
    executionMode,
  });

  return {
    ...result,
    stats: calculateStats(result.equity),
  };
}

function runCausalSimulation({ strategy, aligned, state, userStartIndex, executionMode }) {
  const { dates, series } = aligned;
  const equity = [];
  const tradeLog = [];
  const causalityTrace = [];

  equity[userStartIndex] = 100;
  let currentAllocation = {};

  // Causality guarantee: bar i returns are always computed from weights decided using signalIndex = i - 1.
  for (let i = 1; i < dates.length; i += 1) {
    if (i <= userStartIndex) {
      equity[i] = 100;
      continue;
    }

    const signalIndex = i - 1;
    const signalContext = {
      series,
      state,
      strategy,
      executionMode,
      signalIndex,
      userStartIndex,
      i,
    };

    const signal = computeSignal(signalContext);

    if (!signal.ready) {
      equity[i] = equity[i - 1];
      continue;
    }

    const nextAllocation = signal.allocation;

    if (Object.keys(currentAllocation).length === 0 || !compareAllocations(currentAllocation, nextAllocation)) {
      tradeLog.push(createTradeLogEntry({
        date: dates[signalIndex],
        signal,
        previousAllocation: currentAllocation,
        nextAllocation,
        portfolioValue: equity[i - 1],
        series,
        signalIndex,
        executionMode,
      }));
    }

    const ret = calculatePeriodReturn({
      allocation: nextAllocation,
      series,
      i,
      executionMode,
    });

    causalityTrace.push({
      signalIndex,
      returnIndex: i,
      signalDate: formatDate(dates[signalIndex]),
      returnDate: formatDate(dates[i]),
    });

    equity[i] = equity[i - 1] * (1 + ret);
    currentAllocation = { ...nextAllocation };
  }

  return { dates, equity, tradeLog, causalityTrace };
}

function createTradeLogEntry({ date, signal, previousAllocation, nextAllocation, portfolioValue, series, signalIndex, executionMode }) {
  const priceKey = executionMode === 'close' ? 'close' : 'open';
  const entry = {
    date: formatDate(date),
    sells: [],
    buys: [],
    newAllocation: {},
    executionType: executionMode === 'close' ? 'Close' : 'Open',
  };

  if (typeof signal.extras.riskOn === 'boolean') {
    entry.riskOn = signal.extras.riskOn;
  }

  for (const tk of Object.keys(previousAllocation)) {
    const oldWeight = previousAllocation[tk] || 0;
    const newWeight = nextAllocation[tk] || 0;

    if (newWeight < oldWeight) {
      const delta = portfolioValue * (newWeight - oldWeight);
      const price = series[tk][signalIndex][priceKey];
      entry.sells.push({
        ticker: tk,
        price: price.toFixed(2),
        amount: formatCurrency(Math.abs(delta)),
        shares: Math.abs(delta / price).toFixed(2),
      });
    }
  }

  for (const tk of Object.keys(nextAllocation)) {
    const oldWeight = previousAllocation[tk] || 0;
    const newWeight = nextAllocation[tk] || 0;

    if (newWeight > oldWeight) {
      const delta = portfolioValue * (newWeight - oldWeight);
      const price = series[tk][signalIndex][priceKey];
      entry.buys.push({
        ticker: tk,
        price: price.toFixed(2),
        amount: formatCurrency(delta),
        shares: (delta / price).toFixed(2),
      });
    }

    const price = series[tk][signalIndex][priceKey];
    entry.newAllocation[tk] = {
      weight: formatPercent(newWeight),
      value: formatCurrency(portfolioValue * newWeight),
      price: price.toFixed(2),
    };
  }

  if (Object.keys(previousAllocation).length === 0) {
    entry.isInitial = true;
  }

  return entry;
}

function calculatePeriodReturn({ allocation, series, i, executionMode }) {
  let ret = 0;
  const names = Object.keys(allocation);

  if (names.length === 0) {
    return 0;
  }

  for (const tk of names) {
    const weight = allocation[tk];

    if (executionMode === 'close') {
      ret += weight * (series[tk][i].close / series[tk][i - 1].close - 1);
    } else {
      ret += weight * (series[tk][i].open / series[tk][i - 1].open - 1);
    }
  }

  return ret;
}

function alignSeries(obj) {
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return { dates: [], series: {} };
  }

  const dateSets = keys.map((k) => new Set(obj[k].map((p) => +p.date)));
  const common = [...dateSets.reduce((a, s) => new Set([...a].filter((x) => s.has(x))))].sort((a, b) => a - b);

  const aligned = {};
  for (const k of keys) {
    const map = new Map(obj[k].map((p) => [+p.date, p]));
    aligned[k] = common.map((ts) => map.get(ts));
  }

  return { dates: common.map((ts) => new Date(ts)), series: aligned };
}

function sliceByDate(arr, startDate, endDate) {
  return arr.filter((p) => p.date >= startDate && p.date <= endDate);
}

function calculateStats(equity) {
  // Trim leading undefined / pre-analysis padding so we measure the actual run.
  const firstIdx = equity.findIndex((v) => Number.isFinite(v));
  const trimmed = firstIdx >= 0 ? equity.slice(firstIdx).filter((v) => Number.isFinite(v)) : [];

  if (trimmed.length < 2) {
    return { annualizedReturn: 0, maxDrawdown: 0, sharpe: 0, sortino: 0, calmar: 0 };
  }

  const days = trimmed.length;
  const cagr = calcCAGR(trimmed, days);
  const maxDD = calcMaxDD(trimmed);
  const dailyRet = [];

  for (let i = 1; i < trimmed.length; i += 1) {
    dailyRet.push(trimmed[i] / trimmed[i - 1] - 1);
  }

  const avgRet = dailyRet.reduce((s, r) => s + r, 0) / dailyRet.length;
  const varRet = dailyRet.reduce((s, r) => s + Math.pow(r - avgRet, 2), 0) / dailyRet.length;
  const stdDev = Math.sqrt(varRet);
  const negRet = dailyRet.filter((r) => r < 0);
  const downVar = negRet.reduce((s, r) => s + Math.pow(r, 2), 0) / dailyRet.length;
  const downDev = Math.sqrt(downVar);

  const annRet = cagr;
  const annStd = stdDev * Math.sqrt(252);
  const sharpe = annStd === 0 ? 0 : annRet / annStd;
  const sortino = downDev === 0 ? 0 : annRet / (downDev * Math.sqrt(252));
  const calmar = maxDD === 0 ? 0 : annRet / Math.abs(maxDD);

  return {
    annualizedReturn: annRet,
    maxDrawdown: maxDD,
    sharpe,
    sortino,
    calmar,
  };
}

function calcCAGR(values, days) {
  const years = days / 252;
  return Math.pow(values[values.length - 1] / values[0], 1 / years) - 1;
}

function calcMaxDD(vals) {
  let peak = vals[0];
  let dd = 0;

  for (const v of vals) {
    if (v > peak) peak = v;
    dd = Math.min(dd, (v - peak) / peak);
  }

  return dd;
}

function compareAllocations(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || Math.abs(a[key] - b[key]) > 0.001) {
      return false;
    }
  }

  return true;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(amount) {
  return `$${amount.toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,')}`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

module.exports = {
  STRATEGY_CONFIG,
  runBacktest,
};
