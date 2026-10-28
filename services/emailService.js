// Servicio de EmailJS para envío de respaldos de cortes de caja
// Requiere la librería de EmailJS cargada en el HTML (script)

const EmailService = {
  // Configuración de EmailJS
  config: Object.freeze({
    publicKey: 'SqbjTPIS_U8CAwQTw',
    serviceId: 'service_1576q89',
    templateId: 'template_dkl2n9i'
  }),

  // Redondeo a 2 decimales (mismo criterio que POS.round2)
  round2(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
  },

  getResponseMessage(value, fallback) {
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object') {
      if (typeof value.text === 'string' && value.text.trim()) return value.text;
      if (typeof value.message === 'string' && value.message.trim()) return value.message;
      if (value.response) {
        const responseMessage = this.getResponseMessage(value.response, '');
        if (responseMessage) return responseMessage;
      }
      try {
        return JSON.stringify(value);
      } catch (serializationError) {
        return fallback;
      }
    }
    return fallback;
  },

  getVolumePromotionsSummary(transacciones) {
    let cantidad = 0;
    let monto = 0;
    let piezas = 0;

    (Array.isArray(transacciones) ? transacciones : []).forEach(ticket => {
      (Array.isArray(ticket && ticket.items) ? ticket.items : []).forEach(item => {
        if (!item) return;
        const promo = item.promoVolumenAplicada;
        const precio = Number(promo && promo.precio);
        if (!Number.isFinite(precio) || precio <= 0) return;

        cantidad += 1;
        monto += precio;
        piezas += Number(promo.cantidad || item.cantidad || item.quantity || 1);
      });
    });

    return {
      cantidad: cantidad,
      monto: this.round2(monto),
      piezas: piezas
    };
  },

  getColdItemBreakdown(item) {
    if (!item) {
      return { piezasCant: 0, piezasMonto: 0, cartonesCant: 0, cartonesMonto: 0 };
    }
    const cantidad = Number(item.cantidad || item.quantity || 0);
    const cargoFrio = Number(item.cargoFrio) || 0;
    const unidadesPorCarton = Number(item.unidadesPorCarton || 0);
    const hasPromotion = Number(item.promoVolumenAplicada && item.promoVolumenAplicada.precio) > 0;
    const hasCompleteCarton = !hasPromotion && (
      Boolean(item.isCarton || item.carton || item.charola)
      || (unidadesPorCarton > 0 && cantidad >= unidadesPorCarton)
    );
    const cartonUnits = hasCompleteCarton
      ? (unidadesPorCarton > 0 ? Math.floor(cantidad / unidadesPorCarton) * unidadesPorCarton : cantidad)
      : 0;
    const coldRate = cantidad > 0 ? cargoFrio / cantidad : 0;
    const cartonesMonto = this.round2(coldRate * cartonUnits);

    return {
      piezasCant: Math.max(0, cantidad - cartonUnits),
      piezasMonto: this.round2(cargoFrio - cartonesMonto),
      cartonesCant: cartonUnits,
      cartonesMonto: cartonesMonto
    };
  },

  getColdItemsSummary(transacciones) {
    const resumen = {
      piezasCant: 0,
      piezasMonto: 0,
      cartonesCant: 0,
      cartonesMonto: 0
    };

    (Array.isArray(transacciones) ? transacciones : []).forEach(ticket => {
      (Array.isArray(ticket && ticket.items) ? ticket.items : []).forEach(item => {
        if (!item) return;
        const cargoFrio = Number(item.cargoFrio) || 0;
        if (cargoFrio <= 0) return;

        const detalle = this.getColdItemBreakdown(item);
        resumen.cartonesCant += detalle.cartonesCant;
        resumen.cartonesMonto += detalle.cartonesMonto;
        resumen.piezasCant += detalle.piezasCant;
        resumen.piezasMonto += detalle.piezasMonto;
      });
    });

    resumen.piezasMonto = this.round2(resumen.piezasMonto);
    resumen.cartonesMonto = this.round2(resumen.cartonesMonto);
    return resumen;
  },

  /**
   * Envía el resumen de un corte de caja por correo electrónico.
   * @param {Object} corte - Datos del corte de caja (payload de sendCutByEmail).
   * @param {string} emailDestino - Correo electrónico al que se desea enviar.
   * @param {string} [asunto] - Asunto opcional del correo.
   */
  async sendCorteRespaldo(corte, emailDestino, asunto = 'Respaldo de Corte de Caja') {
    try {
      if (typeof emailjs === 'undefined') {
        throw new Error('La librería de EmailJS no está cargada.');
      }

      if (!corte) {
        throw new Error('El objeto corte es undefined o null.');
      }

      const now = new Date();

      // ---------- DIAGNÓSTICO: Estructura del objeto corte recibido ----------
      console.log('EmailJS >> corte recibido:', {
        id: corte.id,
        turno: corte.turno,
        corteNumero: corte.corteNumero,
        totalVentas: corte.totalVentas,
        ventasEfectivo: corte.ventasEfectivo,
        ventasTarjeta: corte.ventasTarjeta,
        ventasTransferencia: corte.ventasTransferencia,
        descuentosPromociones: corte.descuentosPromociones,
        cantidadVentas: corte.cantidadVentas,
        promocionesAplicadas: JSON.stringify(corte.promocionesAplicadas || []),
        transacciones: JSON.stringify((corte.transacciones || []).map(t => ({
          id: t.id,
          items: JSON.stringify(t.items || [])
        })))
      });

      // ---------- Cálculo de artículos fríos desde los tickets ----------
      const resumenFrio = this.getColdItemsSummary(corte.transacciones);

      console.log('EmailJS >> totales fríos:', {
        piezasFriasCant: resumenFrio.piezasCant,
        piezasFriasMonto: resumenFrio.piezasMonto,
        cartonesFriosCant: resumenFrio.cartonesCant,
        cartonesFriosMonto: resumenFrio.cartonesMonto
      });

      // ---------- Cálculo de promociones ----------
      // DIAGNÓSTICO: imprime los campos crudos del turno antes de filtrar,
      // para ver exactamente qué nombre de propiedad maneja el POS para promociones.
      console.log('EmailJS >> promociones campos crudos:', {
        promocionesAplicadas: JSON.stringify(corte.promocionesAplicadas || []),
        promociones: JSON.stringify(corte.promociones || []),
        descuentos: JSON.stringify(corte.descuentos || []),
        promosAplicados: JSON.stringify(corte.promosAplicados || []),
        descuentosPromociones: corte.descuentosPromociones,
        desglosePromociones: corte.desglose?.promociones,
        desglosePromocionesAplicadas: corte.desglose?.promocionesAplicadas,
        transaccionesConPromoDiscount: (corte.transacciones || [])
          .filter(t => t && Number(t.promoDiscount || 0) > 0)
          .map(t => ({
            id: t.id,
            promoDiscount: t.promoDiscount,
            promosAplicados: JSON.stringify(t.promosAplicados || [])
          })),
        totalVentas: corte.totalVentas,
        cantidadVentas: corte.cantidadVentas
      });

      // Usa la misma propiedad por ítem que suma la tarjeta de Reportes.
      const promocionesResumen = this.getVolumePromotionsSummary(corte.transacciones);

      console.log('EmailJS >> totales promociones:', {
        promocionesCant: promocionesResumen.cantidad,
        promocionesMonto: promocionesResumen.monto,
        promocionesPiezas: promocionesResumen.piezas
      });

      // ---------- Resumen financiero ----------
      const totalVentas = this.round2(Number(corte.totalVentas || corte.total_ventas || 0));
      const ventasEfectivo = this.round2(Number(corte.ventasEfectivo || corte.totalEfectivo || corte.desglose?.ventasEfectivo || 0));
      const ventasTarjeta = this.round2(Number(corte.ventasTarjeta || corte.totalTarjeta || corte.desglose?.ventasTarjeta || 0));
      const ventasTransferencia = this.round2(Number(corte.ventasTransferencia || corte.totalTransferencia || corte.desglose?.ventasTransferencia || 0));
      const fondoInicial = this.round2(Number(corte.fondoInicial || corte.montoApertura || corte.desglose?.fondoInicial || 0));
      const descuentosPromociones = this.round2(Number(corte.descuentosPromociones || 0));
      const cantidadVentas = Number(corte.cantidadVentas || (corte.transacciones ? corte.transacciones.length : 0));

      const capitalReinversion = this.round2(totalVentas - descuentosPromociones);
      const gananciasLibres = this.round2(totalVentas - descuentosPromociones);

      // ---------- Preparar parámetros del template ----------
      const templateParams = {
        to_email: emailDestino,
        subject: asunto,

        // Fecha, hora y turno
        fecha_hora: now.toLocaleString('es-MX', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        }),
        turno_id: corte.turno || corte.corteNumero || 'N/A',

        // Resumen financiero general (claves exactas del template)
        total_ventas: totalVentas,
        efectivo_caja: this.round2(ventasEfectivo + fondoInicial),
        pagos_tarjeta: ventasTarjeta,
        transferencia: ventasTransferencia,
        transacciones: cantidadVentas,
        capital_reinversion: capitalReinversion,
        ganancias_libres: gananciasLibres,

        // Desglose específico (fríos y promociones)
        piezas_frias_cant: resumenFrio.piezasCant,
        piezas_frias_monto: resumenFrio.piezasMonto,
        cartones_frios_cant: resumenFrio.cartonesCant,
        cartones_frios_monto: resumenFrio.cartonesMonto,
        promociones_cant: promocionesResumen.cantidad,
        promociones_monto: promocionesResumen.monto,

        // Campos adicionales de referencia (no entran en el template principal)
        fecha: corte.fecha || corte.fechaCierre || now.toISOString().split('T')[0],
        hora: corte.hora || corte.horaCierre || now.toLocaleTimeString(),
        corte_id: corte.id || 'N/A',
        vendedor: corte.ventas || corte.usuario || 'Sistema',
        productos: corte.productos ? JSON.stringify(corte.productos) : '[]',
        total_efectivo: this.round2(Number(corte.totalEfectivo || 0)),
        total_tarjeta: this.round2(Number(corte.totalTarjeta || 0)),
        total_general: this.round2(Number(corte.totalGeneral || 0)),
        numero_transacciones: Number(corte.numero_transacciones || cantidadVentas)
      };

      // Log previo al envío para verificación local
      console.log('templateParams EmailJS:', templateParams);

      // Depuración específica del desglose para confirmar valores no nulos
      console.log("Desglose:", {
        piezas_frias_monto: resumenFrio.piezasMonto,
        cartones_frios_monto: resumenFrio.cartonesMonto,
        promociones_monto: promocionesResumen.monto
      });

      emailjs.init({ publicKey: 'SqbjTPIS_U8CAwQTw' });
      const response = await emailjs.send(
        this.config.serviceId,
        this.config.templateId,
        templateParams
      );

      console.log('SUCCESS!', response.status, response.text);
      return { success: true, response };
    } catch (error) {
      const errorMessage = this.getResponseMessage(error, 'Error al enviar el correo de respaldo.');
      console.error('FAILED...', errorMessage);
      return { success: false, error: errorMessage };
    }
  }
};

// Exportar para su uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EmailService;
}