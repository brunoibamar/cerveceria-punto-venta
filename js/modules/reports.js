import { db } from '../db.js';

const PERIODS = ['day', 'week', 'month', 'year'];
const PERIOD_LABELS = { day: 'Día', week: 'Semana', month: 'Mes', year: 'Año' };

const CHART_COLORS = [
  '#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1',
];

const CHART_BG = 'rgba(13, 17, 23, 0.7)';
const CHART_BORDER = 'rgba(255, 255, 255, 0.08)';
const CHART_TEXT = '#9ca3af';
const CHART_PRIMARY = '#d97706';

let state = {
  period: 'day',
  date: '',
  charts: {},
};

function formatMoney(value) {
  const num = Number(value);
  return `$${(Number.isFinite(num) ? num : 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function getDateRange(period, dateStr) {
  const today = new Date().toISOString().split('T')[0];
  const base = new Date(`${dateStr || today}T00:00:00`);
  const start = new Date(base);
  const end = new Date(base);

  switch (period) {
    case 'day':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'week':
      start.setDate(base.getDate() - base.getDay() + 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    case 'month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setTime(new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999));
      break;
    case 'year':
      end.setTime(new Date(base.getFullYear(), 11, 31, 23, 59, 59, 999));
      start.setTime(new Date(base.getFullYear(), 0, 1));
      break;
  }

  return { start, end };
}

function filterSales(sales, period, dateStr) {
  const { start, end } = getDateRange(period, dateStr);
  const startMs = start.getTime();
  const endMs = end.getTime();
  return sales.filter((sale) => {
    const t = new Date(sale.date).getTime();
    return t >= startMs && t <= endMs;
  });
}

function findPromoForCombo(comboItems, promos) {
  return promos.find((p) => {
    if (!p.items || p.type !== 'combo') return false;
    const promoIds = p.items.map((i) => i.productId);
    return (
      comboItems.length === promoIds.length &&
      comboItems.every((id) => promoIds.includes(id))
    );
  });
}

function computeKPIs(sales, products, promos) {
  const totalSales = sales.reduce((sum, sale) => sum + (sale.total || 0), 0);
  const transactionCount = sales.length;

  let totalCOGS = 0;
  let promosProfit = 0;

  sales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      const qty = item.qty || 1;

      if (item.isCombo) {
        const promo = findPromoForCombo(item.comboItems || [], promos);
        let comboCost = 0;
        if (promo) {
          comboCost = (promo.cost || 0) * qty;
        } else {
          (item.comboItems || []).forEach((pid) => {
            const prod = products.find((p) => p.id === pid);
            if (prod) comboCost += (prod.costPrice || 0) * qty;
          });
        }
        const comboRevenue = (item.price || 0) * qty;
        totalCOGS += comboCost;
        promosProfit += comboRevenue - comboCost;
      } else {
        const product = products.find((p) => p.id === item.id);
        const unitCost = product ? (product.costPrice || 0) : 0;
        const itemCost = unitCost * qty;
        totalCOGS += itemCost;

        if (item.discount) {
          const itemRevenue = (item.price || 0) * qty;
          promosProfit += itemRevenue - itemCost;
        }
      }
    });
  });

  const netProfit = totalSales - totalCOGS;

  return { totalSales, transactionCount, promosProfit, netProfit, totalCOGS };
}

function computeHourlySales(sales) {
  const totals = new Array(24).fill(0);
  const counts = new Array(24).fill(0);

  sales.forEach((sale) => {
    const hour = new Date(sale.date).getHours();
    totals[hour] += (sale.total || 0);
    counts[hour] += 1;
  });

  const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  return { labels, totals, counts };
}

function computeTopProducts(sales, products, limit = 8) {
  const byProduct = {};

  sales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      const name = item.isCombo ? 'Combo' : (item.name || 'Producto');
      if (!byProduct[name]) {
        byProduct[name] = { qty: 0, revenue: 0 };
      }
      byProduct[name].qty += (item.qty || 1);
      byProduct[name].revenue += (item.price || 0) * (item.qty || 1);
    });
  });

  return Object.entries(byProduct)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

function destroyCharts() {
  Object.values(state.charts).forEach((chart) => {
    if (chart) chart.destroy();
  });
  state.charts = {};
}

function renderSalesByHourChart(sales) {
  const wrapper = document.getElementById('sales-by-hour-wrapper');
  if (!wrapper) return;

  const { labels, totals, counts } = computeHourlySales(sales);

  const hasData = totals.some((v) => v > 0);
  if (!hasData) {
    wrapper.innerHTML =
      '<p class="chart-empty">Sin ventas registradas en el rango seleccionado.</p>';
    return;
  }

  wrapper.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.id = 'sales-by-hour-chart';
  wrapper.appendChild(canvas);

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Total vendido ($)',
          data: totals,
          backgroundColor: `rgba(217, 119, 6, 0.55)`,
          borderColor: CHART_PRIMARY,
          borderWidth: 0,
          barPercentage: 0.75,
          yAxisID: 'y',
        },
        {
          label: 'Transacciones',
          data: counts,
          type: 'line',
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#3b82f6',
          fill: true,
          yAxisID: 'y1',
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: CHART_TEXT, font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: CHART_BG,
          titleColor: '#f3f4f6',
          bodyColor: CHART_TEXT,
          borderColor: CHART_BORDER,
          cornerRadius: 6,
        },
      },
      scales: {
        x: {
          grid: { color: CHART_BORDER },
          ticks: { color: CHART_TEXT, font: { size: 10 } },
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: { color: CHART_BORDER },
          ticks: {
            color: CHART_TEXT,
            font: { size: 10 },
            callback: (v) => `$${v}`,
          },
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: CHART_TEXT, font: { size: 10 } },
        },
      },
    },
  });

  state.charts.salesByHour = chart;
}

function renderTopProductsChart(sales, products) {
  const wrapper = document.getElementById('top-products-wrapper');
  if (!wrapper) return;

  const top = computeTopProducts(sales, products);

  if (top.length === 0) {
    wrapper.innerHTML =
      '<p class="chart-empty">Sin ventas registradas en el rango seleccionado.</p>';
    return;
  }

  const labels = top.map((p) => escapeHtml(p.name));
  const data = top.map((p) => p.qty);
  const bgColors = top.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  wrapper.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.id = 'top-products-chart';
  wrapper.appendChild(canvas);

  const chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: bgColors,
          borderColor: CHART_BG,
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: CHART_TEXT,
            font: { size: 11 },
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: {
          backgroundColor: CHART_BG,
          titleColor: '#f3f4f6',
          bodyColor: CHART_TEXT,
          borderColor: CHART_BORDER,
          cornerRadius: 6,
          callbacks: {
            label: (ctx) => {
              const item = top[ctx.dataIndex];
              const pct = ((item.qty / data.reduce((a, b) => a + b, 0)) * 100).toFixed(1);
              return `${item.name}: ${item.qty} unidades (${pct}%)`;
            },
          },
        },
      },
    },
  });

  state.charts.topProducts = chart;
}

function renderKPIs(sales, products, promos) {
  const kpis = computeKPIs(sales, products, promos);
  const cajaInicial = Number(db.getSetting('cajaInicial', 1300)) || 0;

  const grid = document.getElementById('kpi-grid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="card stat-card kpi-card" data-kpi="caja-inicial">
      <span class="stat-value kpi-editable" data-setting="cajaInicial" title="Haz clic para editar">
        💵 <span class="kpi-amount">${formatMoney(cajaInicial)}</span>
      </span>
      <span class="stat-label">Fondo Inicial de Caja</span>
    </div>
    <div class="card stat-card kpi-card">
      <span class="stat-value">💰 ${formatMoney(kpis.totalSales)}</span>
      <span class="stat-label">Total Ventas</span>
    </div>
    <div class="card stat-card kpi-card">
      <span class="stat-value">🧾 ${kpis.transactionCount}</span>
      <span class="stat-label">Transacciones</span>
    </div>
    <div class="card stat-card kpi-card">
      <span class="stat-value">🏷️ ${formatMoney(kpis.promosProfit)}</span>
      <span class="stat-label">Ganancia por Promociones</span>
    </div>
    <div class="card stat-card kpi-card">
      <span class="stat-value">📈 ${formatMoney(kpis.netProfit)}</span>
      <span class="stat-label">Ganancia Neta Total</span>
    </div>
  `;

  const editable = grid.querySelector('[data-setting="cajaInicial"]');
  if (editable) {
    editable.addEventListener('click', () => {
      const current = Number(db.getSetting('cajaInicial', 1300)) || 0;
      const raw = prompt('Fondo Inicial de Caja ($):', String(current));
      if (raw === null) return;
      const val = Number(raw.replace(/[^\d.]/g, ''));
      if (Number.isFinite(val) && val >= 0) {
        db.setSetting('cajaInicial', val);
        updateReports();
      } else {
        alert('Ingresa un valor numérico válido.');
      }
    });
  }
}

function updateReports() {
  destroyCharts();

  const sales = db.getSales();
  const filtered = filterSales(sales, state.period, state.date);
  const products = db.getProducts();
  const promos = db.getPromos();

  renderKPIs(filtered, products, promos);
  renderSalesByHourChart(filtered);
  renderTopProductsChart(filtered, products);
}

export function renderReports(container, user) {
  state = {
    period: 'day',
    date: new Date().toISOString().split('T')[0],
    charts: {},
  };

  container.innerHTML = `
    <h2 class="view-title">Reportes</h2>
    <p class="muted view-subtitle">Métricas de Caja y Desempeño de Ventas</p>

    <div class="reports-controls">
      <div class="period-selector" role="radiogroup" aria-label="Selector de rango de fechas">
        ${PERIODS.map(
          (p) =>
            `<button type="button" class="period-btn" data-period="${p}" ${p === state.period ? 'active' : ''}>${PERIOD_LABELS[p]}</button>`,
        ).join('')}
      </div>
      <div class="reports-filters">
        <input type="date" id="date-filter" value="${state.date}" />
        <button class="btn btn--ghost btn--sm" id="refresh-btn" type="button">Actualizar</button>
      </div>
    </div>

    <div class="grid stats" id="kpi-grid"></div>

    <div class="charts-grid">
      <div class="chart-card">
        <h3>Ventas por Hora / Horarios Pico</h3>
        <div class="chart-wrapper" id="sales-by-hour-wrapper">
          <canvas id="sales-by-hour-chart"></canvas>
        </div>
      </div>
      <div class="chart-card">
        <h3>Productos Más Vendidos</h3>
        <div class="chart-wrapper" id="top-products-wrapper">
          <canvas id="top-products-chart"></canvas>
        </div>
      </div>
    </div>
  `;

  const periodBtns = container.querySelectorAll('.period-btn');
  periodBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      periodBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.period = btn.dataset.period;
      updateReports();
    });
  });

  const dateFilter = container.querySelector('#date-filter');
  dateFilter.addEventListener('change', () => {
    state.date = dateFilter.value;
    updateReports();
  });

  container.querySelector('#refresh-btn').addEventListener('click', updateReports);

  updateReports();
}
