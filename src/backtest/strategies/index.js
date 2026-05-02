const { computeRSI } = require('../indicators');
const { signalDMR } = require('./dmr');
const { signalBarbell } = require('./barbell');
const { signalTrend } = require('./trend');
const { signalTurbo } = require('./turbo');

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
};

const SIGNAL_BY_STRATEGY = {
  dmr: signalDMR,
  barbell: signalBarbell,
  trend: signalTrend,
  turbo: signalTurbo,
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

  return state;
}

module.exports = {
  STRATEGY_CONFIG,
  computeSignal,
  buildStrategyState,
};
