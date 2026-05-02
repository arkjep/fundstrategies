function sma(arr, i, len) {
  if (i < len - 1) return null;
  let s = 0;
  for (let k = i - len + 1; k <= i; k += 1) s += arr[k].close;
  return s / len;
}

function computeRSI(arr, len = 14) {
  const res = new Array(arr.length).fill(null);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < len; i += 1) {
    const diff = arr[i].close - arr[i - 1].close;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  for (let i = len; i < arr.length; i += 1) {
    const diff = arr[i].close - arr[i - 1].close;

    if (diff >= 0) {
      gains = ((gains * (len - 1)) + diff) / len;
      losses = (losses * (len - 1)) / len;
    } else {
      gains = (gains * (len - 1)) / len;
      losses = ((losses * (len - 1)) - diff) / len;
    }

    const rs = losses === 0 ? 100 : gains / losses;
    res[i] = 100 - 100 / (1 + rs);
  }

  return res;
}

function avgDollarVol(arr, i, len = 20) {
  if (i < len - 1) return 0;

  let sum = 0;
  let count = 0;
  for (let k = i - len + 1; k <= i; k += 1) {
    const p = arr[k];
    if (!p) continue;
    if (Number.isFinite(p.close) && Number.isFinite(p.vol)) {
      sum += p.close * p.vol;
      count += 1;
    }
  }

  return count ? (sum / len) : 0;
}

function dailyReturns(arr, i, len) {
  const out = [];
  if (i < len) return out;
  for (let k = i - len + 1; k <= i; k += 1) {
    const a = arr[k - 1];
    const b = arr[k];
    if (!a || !b) continue;
    const ac = a.close;
    const bc = b.close;
    if (Number.isFinite(ac) && Number.isFinite(bc) && ac > 0 && bc > 0) {
      out.push(bc / ac - 1);
    }
  }
  return out;
}

function stdev(arr, i, len) {
  const r = dailyReturns(arr, i, len);
  if (r.length < 2) return 0;
  const mean = r.reduce((s, x) => s + x, 0) / r.length;
  const v = r.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (r.length - 1);
  return Math.sqrt(v);
}

function correlation(a, b, i, len) {
  const ra = dailyReturns(a, i, len);
  const rb = dailyReturns(b, i, len);
  const n = Math.min(ra.length, rb.length);
  if (n < 5) return 0;
  const ax = ra.slice(ra.length - n);
  const bx = rb.slice(rb.length - n);
  const ma = ax.reduce((s, x) => s + x, 0) / n;
  const mb = bx.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let k = 0; k < n; k += 1) {
    const da = ax[k] - ma;
    const db = bx[k] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

module.exports = {
  sma,
  computeRSI,
  avgDollarVol,
  stdev,
  correlation,
};
