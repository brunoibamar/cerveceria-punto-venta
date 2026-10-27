import re
p='js/reports.js'
s=open(p).read()
old='''    const promoGains = filtered.reduce((sum, s) => {
      const pd = Number(s.promoDiscount) || 0;
      if (pd <= 0) return sum;
      return sum + pd;
    }, 0);'''
new='''    const promoGains = filtered.reduce((sum, s) => {
      const pd = Number(s.promoDiscount) || 0;
      if (pd <= 0) return sum;
      return sum + pd;
    }, 0);

    let piezasFrias = 0;
    let cartonesFrios = 0;
    filtered.forEach(s => {
      (s.items || []).forEach(item => {
        const cold = item.cold === true || item.piezaFria === true || item.piezaFria === 'true';
        if (!cold) return;
        const qty = Number(item.quantity || item.cantidad || 0) || 0;
        const cargoFrio = Number(item.cargoFrio || 0) || 0;
        const subtotal = Number(item.subtotal || 0) || 0;
        const isCarton = Boolean(item.isCarton || item.carton || item.charola);
        if (isCarton) cartonesFrios += subtotal || (cargoFrio * qty);
        else piezasFrias += cargoFrio > 0 ? (cargoFrio * qty) : subtotal;
      });
      const tc = Number(s.coldCharge || 0) || 0;
      if (tc > 0 && piezasFrias === 0) piezasFrias += tc;
    });'''
assert old in s
s=s.replace(old,new)

anchor='''          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Ganancias de Promociones</span><span class="metric-icon">ðŸŽ</span></div>
            <div class="metric-value">${this.formatCurrency(promoGains)}</div>
            <div class="metric-sub">Descuentos aplicados</div>
          </div>
        </div>'''
addition='''          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Ganancias de Promociones</span><span class="metric-icon">ðŸŽ</span></div>
            <div class="metric-value">${this.formatCurrency(promoGains)}</div>
            <div class="metric-sub">Descuentos aplicados</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Piezas frías ($)</span><span class="metric-icon">ðŸ§Š</span></div>
            <div class="metric-value">${this.formatCurrency(piezasFrias)}</div>
            <div class="metric-sub">Cargo frío en piezas sueltas</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Cartones fríos ($)</span><span class="metric-icon">ðŸ“¦</span></div>
            <div class="metric-value">${this.formatCurrency(cartonesFrios)}</div>
            <div class="metric-sub">Cartones / charolas completas</div>
          </div>
          <div class="metric-card">
            <div class="metric-row"><span class="metric-label">Promociones ($)</span><span class="metric-icon">ðŸŽ</span></div>
            <div class="metric-value">${this.formatCurrency(promoGains)}</div>
            <div class="metric-sub">Impacto de promociones</div>
          </div>
        </div>'''
assert anchor in s
s=s.replace(anchor,addition)
open(p,'w').write(s)
print('done')
PY