const express = require('express');
const path = require('node:path');

const { getHistoryCsv, getHistorySeries, sanitizeSymbol } = require('../services/historyService');
const { STRATEGY_CONFIG, runBacktest } = require('../backtest/engine');
const { attachDevReload } = require('./devReload');

function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));
  attachDevReload(app);
  app.use(express.static(path.join(process.cwd(), 'public')));

  app.get('/api/history', async (req, res) => {
    try {
      const symbol = sanitizeSymbol(req.query.symbol || '');
      if (!symbol) {
        res.status(400).type('text/plain').send('Missing or bad symbol');
        return;
      }

      const payload = await getHistoryCsv(symbol);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('X-Source', payload.source);
      if (payload.upstreamError) {
        res.setHeader('X-Upstream-Error', trimHeaderValue(payload.upstreamError));
      }
      res.send(payload.csv);
    } catch (err) {
      res.status(err.status || 500).type('text/plain').send(err.message || 'Server error');
    }
  });

  app.post('/api/backtest', async (req, res) => {
    try {
      const strategy = String(req.body?.strategy || 'dmr').toLowerCase();
      const executionMode = req.body?.executionMode === 'open' ? 'open' : 'close';
      const startDate = new Date(String(req.body?.startDate || '1993-01-29'));
      const endDateInput = req.body?.endDate;
      const endDate = endDateInput ? new Date(String(endDateInput)) : new Date();

      if (!STRATEGY_CONFIG[strategy]) {
        res.status(400).json({ error: `Unknown strategy: ${strategy}` });
        return;
      }

      if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate > endDate) {
        res.status(400).json({ error: 'Invalid date range' });
        return;
      }

      const lookbackDays = STRATEGY_CONFIG[strategy].lookback;
      const fetchStartDate = new Date(startDate);
      fetchStartDate.setDate(fetchStartDate.getDate() - Math.ceil(lookbackDays * 1.4));

      const tickers = STRATEGY_CONFIG[strategy].tickers;
      const byTicker = {};

      for (const tk of tickers) {
        const fullSeries = await getHistorySeries(`${tk}.us`);
        byTicker[tk] = fullSeries;
      }

      const result = runBacktest({
        strategy,
        byTicker,
        startDate: fetchStartDate,
        analysisStartDate: startDate,
        endDate,
        executionMode,
      });

      res.json({
        strategy,
        executionMode,
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        dates: result.dates.map((d) => d.toISOString().slice(0, 10)),
        equity: result.equity,
        tradeLog: result.tradeLog,
        stats: result.stats,
        causality: {
          signalLagBars: 1,
          rule: 'weights(i) are computed using market data through bar i-1 only',
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message || 'Backtest failed' });
    }
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
  });

  return app;
}

function trimHeaderValue(value) {
  return String(value).replace(/[\r\n]/g, ' ').slice(0, 200);
}

module.exports = {
  createApp,
};
