import { db } from '../db.js';

export function render(container) {
  const sales = db.getSales();
  const total = sales.reduce((sum, sale) => sum + sale.total, 0);
  const count = sales.length;
  const avg = count ? total / count : 0;

  const byProduct = {};
  sales.forEach((sale) => {
    sale.items.forEach((item) => {
      byProduct[item.name] = (byProduct[item.name] || 0) + item.qty;
    });
  });
  const top = Object.entries(byProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const recent = [...sales]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  container.innerHTML = `
    <h2 class="view-title">Reportes y Métricas de Venta</h2>
    <div class="grid stats">
      <div class="card stat-card">
        <span class="stat-value">$${total.toFixed(2)}</span>
        <span class="stat-label">Ventas totales</span>
      </div>
      <div class="card stat-card">
        <span class="stat-value">${count}</span>
        <span class="stat-label">Tickets</span>
      </div>
      <div class="card stat-card">
        <span class="stat-value">$${avg.toFixed(2)}</span>
        <span class="stat-label">Ticket promedio</span>
      </div>
    </div>
    <h3 class="section-title">Más vendidos</h3>
    <ul class="list">
      ${
        top.length
          ? top
              .map(
                ([name, qty]) => `
          <li class="list-item">
            <span>${name}</span>
            <span class="badge">${qty} unidades</span>
          </li>
        `,
              )
              .join('')
          : '<li class="list-item muted">Sin ventas registradas</li>'
      }
    </ul>
    <h3 class="section-title">Últimas ventas</h3>
    <ul class="list">
      ${
        recent.length
          ? recent
              .map(
                (sale) => `
          <li class="list-item">
            <span>${new Date(sale.date).toLocaleString()}</span>
            <span class="price">$${sale.total.toFixed(2)}</span>
          </li>
        `,
              )
              .join('')
          : '<li class="list-item muted">Sin ventas registradas</li>'
      }
    </ul>
  `;
}
