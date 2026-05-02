const { computeRSI } = require('../indicators');
const { signalDMR } = require('./dmr');
const { signalBarbell } = require('./barbell');
const { signalTrend } = require('./trend');
const { signalTurbo } = require('./turbo');
const { signalApex } = require('./apex');

const APEX_TICKERS = [
  'spy', 'qqq', 'iwm', 'shy', 'gld',
  'tqqq', 'upro', 'soxl', 'tecl', 'fngu', 'labu', 'webl', 'retl', 'want', 'dfen', 'udow',
];

const APEX_RESERVED = new Set(['spy', 'qqq', 'iwm', 'shy', 'gld', 'tlt', 'tmf', 'splv']);

const STRATEGY_CONFIG = {
  dmr: {
    tickers: ['spy', 'qqq', 'iwm', 'tlt', 'gld', 'shy'],
    lookback: 200,
  },
  barbell: {
    tickers: ['upro', 'splv', 'tmf', 'shy', 'spy', 'tlt'],
    lookback: 100,
  },
  trend: {
    tickers: ['upro', 'spy'],
    lookback: 100,
  },
  turbo: {
    tickers: ['soxl', 'tecl', 'fngu', 'tqqq', 'upro', 'labu', 'webl', 'retl', 'want', 'dfen', 'udow', 'tmf', 'shy', 'spy', 'tlt'],
    lookback: 200,
  },
  apex: {
    tickers: APEX_TICKERS,
    lookback: 280,
  },
};

const SIGNAL_BY_STRATEGY = {
  dmr: signalDMR,
  barbell: signalBarbell,
  trend: signalTrend,
  turbo: signalTurbo,
  apex: signalApex,
};

function computeSignal(ctx) {
  const handler = SIGNAL_BY_STRATEGY[ctx.strategy];
  if (!handler) return { ready: false, allocation: {}, extras: {} };
  return handler(ctx);
}

function buildStrategyState(strategy, series) {
  const state = { spyRSI: computeRSI(series.spy) };

  if (strategy === 'turbo') {
    state.turboUniverse = Object.keys(series).filter((tk) => !['spy', 'tlt', 'tmf', 'shy'].includes(tk));
  }

  if (strategy === 'apex') {
    state.apexUniverse = Object.keys(series).filter((tk) => !APEX_RESERVED.has(tk));
  }

  return state;
}

module.exports = {
  STRATEGY_CONFIG,
  computeSignal,
  buildStrategyState,
};
