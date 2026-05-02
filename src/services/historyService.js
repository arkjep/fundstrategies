const fs = require('node:fs/promises');
const path = require('node:path');

const CACHE_DIR = path.join(process.cwd(), 'cache');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 15000;
const MAX_UPSTREAM_RETRIES = 3;

const inflightByKey = new Map();

async function getHistoryCsv(rawSymbol) {
  const symbol = sanitizeSymbol(rawSymbol);
  const interval = 'd';

  if (!symbol) {
    const error = new Error('Missing or bad symbol');
    error.status = 400;
    throw error;
  }

  const cacheKey = `${symbol}_${interval}_v2`;
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.csv`);

  await fs.mkdir(CACHE_DIR, { recursive: true });

  const cached = await readCache(cacheFile);
  if (cached && !cached.isStale) {
    return { csv: cached.data, source: 'cache' };
  }

  const fetchPromise = inflightByKey.get(cacheKey) || fetchAndCache(symbol, interval, cacheFile);
  inflightByKey.set(cacheKey, fetchPromise);

  try {
    const csv = await fetchPromise;
    return { csv, source: 'fresh' };
  } catch (err) {
    if (cached && cached.data) {
      return {
        csv: cached.data,
        source: 'stale-cache',
        upstreamError: err.message || 'upstream-failure',
      };
    }

    const error = new Error(`Remote fetch failed: ${err.message || 'unknown error'}`);
    error.status = 502;
    throw error;
  } finally {
    inflightByKey.delete(cacheKey);
  }
}

async function getHistorySeries(rawSymbol) {
  const { csv } = await getHistoryCsv(rawSymbol);
  return csvToSeries(csv);
}

function csvToSeries(csv) {
  const lines = csv.trim().split(/\n+/);
  const out = [];

  for (let i = 1; i < lines.length; i += 1) {
    const [d, o, , , c, v] = lines[i].split(',');
    const date = new Date(d);
    const open = Number(o);
    const close = Number(c);
    const vol = Number(v);

    if (!Number.isFinite(date.getTime()) || !Number.isFinite(open) || !Number.isFinite(close)) {
      continue;
    }

    out.push({
      date,
      open,
      close,
      vol: Number.isFinite(vol) ? vol : 0,
    });
  }

  out.sort((a, b) => a.date - b.date);
  return out;
}

function sanitizeSymbol(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
}

async function readCache(cacheFile) {
  try {
    const stat = await fs.stat(cacheFile);
    const data = await fs.readFile(cacheFile, 'utf8');
    return {
      data,
      isStale: (Date.now() - stat.mtimeMs) > CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

async function fetchAndCache(symbol, interval, cacheFile) {
  const yahooSymbol = toYahooSymbol(symbol);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?period1=0&period2=${period2}&interval=1d&includePrePost=false&events=history`;

  let lastError = new Error('Unknown upstream error');

  for (let attempt = 1; attempt <= MAX_UPSTREAM_RETRIES; attempt += 1) {
    try {
      const rawJson = await fetchBody(url);
      const csv = yahooChartJsonToCsv(rawJson, yahooSymbol);
      await fs.writeFile(cacheFile, csv, 'utf8');
      return csv;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_UPSTREAM_RETRIES) {
        const backoffMs = 300 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        await delay(backoffMs);
      }
    }
  }

  throw lastError;
}

async function fetchBody(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'fundstrategies-node-proxy/2.0',
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
      },
    });

    const body = await response.text();

    if (!response.ok) {
      throw new Error(`Upstream status ${response.status}`);
    }

    return body;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Upstream timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function yahooChartJsonToCsv(rawJson, symbol) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Upstream returned non-JSON response');
  }

  const result = parsed?.chart?.result?.[0];
  const error = parsed?.chart?.error;

  if (error) {
    throw new Error(error.description || `Upstream error for ${symbol}`);
  }

  if (!result) {
    throw new Error(`No chart result for ${symbol}`);
  }

  const timestamps = result.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];
  const volumes = quote.volume || [];

  const lines = ['Date,Open,High,Low,Close,Volume'];

  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i];
    const o = opens[i];
    const h = highs[i];
    const l = lows[i];
    const c = closes[i];
    const v = volumes[i];

    if (![o, h, l, c].every(Number.isFinite)) {
      continue;
    }

    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    const volume = Number.isFinite(v) ? Math.trunc(v) : 0;

    lines.push([
      date,
      normalizeNumber(o),
      normalizeNumber(h),
      normalizeNumber(l),
      normalizeNumber(c),
      String(volume),
    ].join(','));
  }

  if (lines.length < 2) {
    throw new Error(`No usable OHLC rows for ${symbol}`);
  }

  return `${lines.join('\n')}\n`;
}

function normalizeNumber(value) {
  return Number(value).toFixed(6).replace(/\.?0+$/, '');
}

function toYahooSymbol(symbol) {
  return symbol.replace(/\.us$/i, '').toUpperCase();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  getHistoryCsv,
  getHistorySeries,
  sanitizeSymbol,
};
