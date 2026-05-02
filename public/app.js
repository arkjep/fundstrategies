const runBtn = document.getElementById('runBtn');
const strategySelect = document.getElementById('strategySelect');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const executionToggle = document.getElementById('executionToggle');
const statsEl = document.getElementById('stats');
const tradeLogEl = document.getElementById('tradeLog');

endDateInput.valueAsDate = new Date();

let equityChartInstance;

runBtn.addEventListener('click', runBacktest);

async function runBacktest() {
  try {
    runBtn.disabled = true;
    statsEl.textContent = 'Running backtest...';
    tradeLogEl.textContent = 'Loading trades...';

    const response = await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy: strategySelect.value,
        startDate: startDateInput.value,
        endDate: endDateInput.value,
        executionMode: executionToggle.value,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Request failed');
    }

    renderStats(payload.stats, payload.causality);
    renderChart(payload.dates, payload.equity, payload.strategy);
    renderTradeLog(payload.tradeLog);
  } catch (err) {
    statsEl.textContent = `Error: ${err.message}`;
    tradeLogEl.textContent = 'No trades available.';
  } finally {
    runBtn.disabled = false;
  }
}

function renderStats(stats, causality) {
  const html = [
    `<strong>Annualized Return:</strong> ${toPct(stats.annualizedReturn)}`,
    `<strong>Max Drawdown:</strong> ${toPct(stats.maxDrawdown)}`,
    `<strong>Sharpe:</strong> ${stats.sharpe.toFixed(2)}`,
    `<strong>Sortino:</strong> ${stats.sortino.toFixed(2)}`,
    `<strong>Calmar:</strong> ${stats.calmar.toFixed(2)}`,
    `<strong>Causality:</strong> ${causality.rule}`,
  ].join(' | ');

  statsEl.innerHTML = html;
}

function renderChart(dates, equity, label) {
  const ctx = document.getElementById('equityChart').getContext('2d');

  if (equityChartInstance) {
    equityChartInstance.destroy();
  }

  equityChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dates,
      datasets: [{
        label: label.toUpperCase(),
        data: equity,
        borderWidth: 1.4,
        pointRadius: 0,
        borderColor: '#0f766e',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { maxTicksLimit: 12 },
        },
      },
    },
  });
}

function renderTradeLog(tradeLog) {
  if (!Array.isArray(tradeLog) || tradeLog.length === 0) {
    tradeLogEl.textContent = 'No trades in selected period.';
    return;
  }

  let html = '';

  for (const entry of tradeLog) {
    html += '<article class="trade-entry">';
    html += `<div class="trade-date">${entry.date}</div>`;

    if (typeof entry.riskOn === 'boolean') {
      html += `<div class="risk-chip">Risk ${entry.riskOn ? 'ON' : 'OFF'}</div>`;
    }

    if (entry.isInitial) {
      html += '<div class="tx">Initial allocation</div>';
    }

    if (entry.sells.length > 0) {
      html += '<div class="tx-header">Sells</div>';
      for (const tx of entry.sells) {
        html += `<div class="tx">Sell ${tx.shares} ${tx.ticker.toUpperCase()} @ ${tx.price} (${tx.amount})</div>`;
      }
    }

    if (entry.buys.length > 0) {
      html += '<div class="tx-header">Buys</div>';
      for (const tx of entry.buys) {
        html += `<div class="tx">Buy ${tx.shares} ${tx.ticker.toUpperCase()} @ ${tx.price} (${tx.amount})</div>`;
      }
    }

    html += '</article>';
  }

  tradeLogEl.innerHTML = html;
}

function toPct(value) {
  return `${(value * 100).toFixed(2)}%`;
}
