const SalesLog = {
  // Detecta si un renglón del ticket corresponde a una bebida fría
  isColdItem(item) {
    if (!item) return false;
    if (item.piezaFria === true || item.piezaFria === 'true') return true;
    if (item.cold === true) return true;
    if (typeof item.temp === 'string' && item.temp.toLowerCase() === 'frio') return true;
    return false;
  },

  // Hora exacta de la transacción en formato HH:MM:SS (hora local)
  timeLabel(value) {
    const date = value ? new Date(value) : new Date();
    if (isNaN(date.getTime())) return '--:--:--';
    const pad = (n) => String(n).padStart(2, '0');
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  },

  // Llave de fecha local (YYYY-MM-DD)
  dateKey(value) {
    const date = value ? new Date(value) : new Date();
    if (isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  },

  // Desglose legible de los productos: "1x Caguama Corona, 3x Latas Corona"
  describeItems(items) {
    const list = (items || []).map(item => {
      const cantidad = Number(item.cantidad !== undefined ? item.cantidad : item.quantity) || 0;
      const nombre = item.nombre || item.productName || 'Producto';
      return cantidad + 'x ' + nombre;
    });
    return list.length ? list.join(', ') : 'Sin productos';
  },

  // Etiqueta corta de la forma de cobro con tarjeta (NFC, QR o Terminal)
  paymentChannelLabel(sale) {
    const detail = (sale && sale.paymentDetail) || {};
    const channel = detail.channel;
    if (!channel) return '';
    if (typeof SalesPayment !== 'undefined' && SalesPayment.getChannelLabel) {
      return SalesPayment.getChannelLabel(channel);
    }
    return String(channel).toUpperCase();
  },

  // Etiqueta del método de pago: Efectivo, Tarjeta, Transferencia o Mixto
  paymentLabel(sale) {
    if (!sale) return 'Efectivo';
    const breakdown = sale.paymentBreakdown || {};
    const channel = this.paymentChannelLabel(sale);
    const suffix = channel ? ' · ' + channel : '';

    if (sale.paymentMethod === 'mixto') {
      const parts = [];
      if (Number(breakdown.efectivo) > 0) parts.push('Efectivo');
      if (Number(breakdown.tarjeta) > 0) parts.push('Tarjeta');
      if (Number(breakdown.transferencia) > 0) parts.push('Transferencia');
      const base = parts.length ? parts.join(' + ') : 'Mixto';
      return channel ? base + suffix : base;
    }
    if (sale.paymentMethod === 'tarjeta') return 'Tarjeta' + suffix;
    if (sale.paymentMethod === 'transferencia') return 'Transferencia' + suffix;
    return 'Efectivo';
  },

  // Icono del método de pago
  paymentIcon(method) {
    if (method === 'tarjeta') return '💳';
    if (method === 'transferencia') return '🏦';
    if (method === 'mixto') return '🔀';
    return '💵';
  },

  // Número válido o valor por defecto
  toNumber(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  },

  // Redondeo a dos decimales
  round2(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
  },

  // Versión ligera del ticket para archivarlo dentro del corte de caja.
  // Incluye los ítems completos (nombre, cantidad, subtotal, cargo frío)
  // para que el corte pueda renderizar el desglose de productos vendidos.
  compactTicket(ticket) {
    if (!ticket) return null;
    const items = Array.isArray(ticket.items) ? ticket.items.map(item => ({
      productId: item.productId || null,
      costoTotal: item.costoTotal ?? null,
      nombre: item.nombre || item.productName || 'Producto',
      marca: item.marca || '',
      cantidad: Number(item.cantidad !== undefined ? item.cantidad : item.quantity) || 0,
      precio: Number(item.precio !== undefined ? item.precio : item.price) || 0,
      precioCarton: Number(item.precioCarton) || 0,
      cold: Boolean(item.cold === true || item.piezaFria === true || item.piezaFria === 'true'),
      cargoFrio: Number(item.cargoFrio) || 0,
      envaseFaltante: Boolean(item.envaseFaltante),
      envaseModalidad: item.envaseModalidad || 'pieza',
      envaseCargo: Number(item.envaseCargo || 0),
      isCarton: Boolean(item.isCarton || item.carton || item.charola),
      unidadesPorCarton: Number(item.unidadesPorCarton || 0),
      promoVolumenAplicada: item.promoVolumenAplicada ? {
        cantidad: Number(item.promoVolumenAplicada.cantidad) || 0,
        precio: Number(item.promoVolumenAplicada.precio) || 0
      } : null,
      subtotal: Number(item.subtotal) || 0
    })) : [];
    return {
      id: ticket.id,
      fecha: ticket.fecha,
      hora: ticket.hora,
      items: items,
      detalle: ticket.detalle,
      unidades: ticket.unidades,
      cold: ticket.cold,
      subtotal: ticket.subtotal,
      coldCharge: ticket.coldCharge,
      promoDiscount: ticket.promoDiscount,
      volumePromoDiscount: ticket.volumePromoDiscount,
      total: ticket.total,
      paymentMethod: ticket.paymentMethod,
      paymentLabel: ticket.paymentLabel,
      paymentDetail: ticket.paymentDetail,
      breakdown: ticket.breakdown,
      turnoId: ticket.turnoId,
      turnoNumero: ticket.turnoNumero,
      cajero: ticket.cajero,
      cajeroId: ticket.cajeroId || null,
      cajeroRol: ticket.cajeroRol || null,
      status: ticket.status
    };
  },

  // Convierte una venta registrada en la base de datos en un ticket de historial
  buildTicket(sale) {
    const source = sale || {};
    const fecha = source.fecha || new Date().toISOString();
    const rawItems = Array.isArray(source.items) ? source.items : [];

      const items = rawItems.map(item => {
        const cantidad = Number(item.quantity) || 0;
        const precio = Number(item.precio !== undefined ? item.precio : item.price) || 0;
        const unidadesPorCarton = Number(item.unidadesPorCarton) || 0;
        const precioCarton = Number(item.precioCarton) || 0;
        const cold = this.isColdItem(item);
        const cargoFrio = Number(item.cargoFrio) || 0;
        const promoVolumenAplicada = item.promoVolumenAplicada ? {
          cantidad: Number(item.promoVolumenAplicada.cantidad) || 0,
          precio: Number(item.promoVolumenAplicada.precio) || 0
        } : null;
        const cartonesCompletos = unidadesPorCarton > 0 && precioCarton > 0
          ? Math.floor(cantidad / unidadesPorCarton)
          : 0;
        const piezasRestantes = cartonesCompletos > 0 ? cantidad % unidadesPorCarton : cantidad;
        const subtotal = cartonesCompletos > 0
          ? cartonesCompletos * precioCarton + piezasRestantes * precio
          : promoVolumenAplicada && promoVolumenAplicada.cantidad === cantidad
            ? promoVolumenAplicada.precio
            : precio * cantidad;
        return {
          productId: item.productId || null,
          costoTotal: item.costoTotal ?? null,
          nombre: item.nombre || item.productName || 'Producto',
          marca: item.marca || '',
          cantidad,
          precio,
          cold,
          cargoFrio,
          envaseFaltante: Boolean(item.envaseFaltante),
          envaseModalidad: item.envaseModalidad || 'pieza',
          envaseCargo: Number(item.envaseCargo || 0),
          isCarton: Boolean(item.isCarton || item.carton || item.charola),
          unidadesPorCarton,
          precioCarton,
          promoVolumenAplicada,
          subtotal: this.round2(subtotal)
        };
      });

    const computedColdUnits = items.reduce((sum, item) => sum + (item.cold ? item.cantidad : 0), 0);
    const computedColdCharge = items.reduce((sum, item) => sum + (item.cold ? item.cargoFrio : 0), 0);
    const computedSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const breakdown = source.paymentBreakdown || {};

    const coldUnits = this.toNumber(source.coldUnits, computedColdUnits);
    const coldCharge = this.round2(this.toNumber(source.coldCharge, computedColdCharge));
    const subtotal = this.round2(this.toNumber(source.subtotal, computedSubtotal));

    return {
      id: source.id || '',
      fecha: fecha,
      hora: this.timeLabel(fecha),
      items: items,
      detalle: this.describeItems(items),
      unidades: items.reduce((sum, item) => sum + item.cantidad, 0),
      cold: {
        unidades: coldUnits,
        cargo: coldCharge,
        aplicado: coldUnits > 0
      },
      subtotal: subtotal,
      coldCharge: coldCharge,
      promoDiscount: Number(source.promoDiscount) || 0,
      volumePromoDiscount: Number(source.volumenPromoDiscount !== undefined ? source.volumenPromoDiscount : source.volumePromoDiscount) || 0,
      total: Number(source.total) || 0,
      paymentMethod: source.paymentMethod || 'efectivo',
      paymentLabel: this.paymentLabel(source),
      paymentDetail: source.paymentDetail || null,
      breakdown: {
        efectivo: Number(breakdown.efectivo) || 0,
        tarjeta: Number(breakdown.tarjeta) || 0,
        transferencia: Number(breakdown.transferencia) || 0,
        recibido: Number(breakdown.recibido) || 0,
        cambio: Number(breakdown.cambio) || 0
      },
      turnoId: source.turnoId || null,
      turnoNumero: source.turnoNumero || null,
      cajero: source.cajero || null,
      cajeroId: source.cajeroId || null,
      cajeroRol: source.cajeroRol || null,
      corteId: source.corteId || null,
      corteNumero: source.corteNumero || null,
      status: source.status || 'completada'
    };
  }
};
