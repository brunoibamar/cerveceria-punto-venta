// Servicio de EmailJS para envío de respaldos de cortes de caja
// Requiere la librería de EmailJS cargada en el HTML (script)

const EmailService = {
  // Configuración de EmailJS
  config: {
    publicKey: 'SqbTPIS_U8CAwQTw', // Public Key oficial de EmailJS
    serviceId: 'service_1576q89', // Service ID oficial de EmailJS
    templateId: 'template_dkl2n9i' // Template ID oficial de EmailJS
  },

  // Redondeo a 2 decimales (mismo criterio que POS.round2)
  round2(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round(amount * 100) / 100;
  },

  /**
   * Envía el resumen de un corte de caja por correo electrónico.
   * @param {Object} corte - Datos del corte de caja (payload de sendCutByEmail).
   * @param {string} emailDestino - Correo electrónico al que se desea enviar.
   * @param {string} [asunto] - Asunto opcional del correo.
   */
  async sendCorteRespaldo(corte, emailDestino, asunto = 'Respaldo de Corte de Caja') {
    try {
      // Validar que emailjs esté disponible
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
      // Construir set de nombres de producto que pertenecen a promociones
      // para excluirlos del conteo de piezas frías / cartones fríos
      const nombresPromo = new Set();
      (corte.promocionesAplicadas || []).forEach(promo => {
        if (Array.isArray(promo.detalle)) {
          promo.detalle.forEach(d => {
            if (d && d.nombre) nombresPromo.add(String(d.nombre).toUpperCase().trim());
          });
        }
      });

      console.log('EmailJS >> nombresPromo excluidos:', Array.from(nombresPromo));

      let piezasFriasCant = 0;
      let piezasFriasMonto = 0;
      let cartonesFriosCant = 0;
      let cartonesFriosMonto = 0;

      (corte.transacciones || []).forEach(ticket => {
        (ticket.items || []).forEach(item => {
          if (!item) return;
          const nombre = String(item.nombre || item.productName || '').toUpperCase().trim();

          // 1. Excluir estrictamente cualquier producto que sea parte de una promoción/paquete
          const esPromo = nombresPromo.has(nombre);
          if (esPromo) {
            console.log('EmailJS >> ítem excluido (promo):', { nombre, cantidad: item.cantidad || item.quantity });
            return;
          }

          // 2. Solo procesar productos que tengan cargo de frío (cargoFrio > 0)
          const cargoFrio = Number(item.cargoFrio || 0);
          const qty = Number(item.cantidad || item.quantity || 0);
          const precio = Number(item.precio || item.price || 0);
          const subtotal = Number(item.subtotal || 0);
          const unidadesPorCarton = Number(item.unidadesPorCarton || 0);

          if (cargoFrio <= 0) {
            console.log('EmailJS >> ítem ignorado (sin cargo frío):', { nombre, cargoFrio, qty });
            return;
          }

          // 3. Detectar si es cartón/charola completa de forma robusta
          //    - nombre contiene 'MEGA', 'CARTON' o 'CHAROLA' (paquetes grandes tipo Mega Corona 12+)
          //    - envaseModalidad === 'carton'
          //    - unidadesPorCarton definido y qty cumple o supera ese número
          //    - qty >= 12 (paquete grande por volumen)
          const nombreEsCarton = nombre.includes('MEGA')
            || nombre.includes('CARTON')
            || nombre.includes('CHAROLA')
            || nombre.includes('PAQUETE')
            || nombre.includes('PACK');
          const envaseEsCarton = item.envaseModalidad === 'carton';
          const qtyEsCarton = unidadesPorCarton > 0 && qty >= unidadesPorCarton;
          const volumenEsCarton = qty >= 12; // paquetes de 12+ se consideran cartón/charola
          const esCarton = nombreEsCarton || envaseEsCarton || qtyEsCarton || volumenEsCarton;

          // Monto del ítem: usar SOLO cargoFrio (costo del frío por empaque, ya es el total)
          // NO multiplicar por qty para evitar inflar el monto
          const montoItem = cargoFrio > 0 ? cargoFrio : (subtotal > 0 ? subtotal : 0);

          console.log('EmailJS >> ítem frío clasificado:', {
            nombre, qty, precio, cargoFrio, subtotal,
            envaseModalidad: item.envaseModalidad,
            unidadesPorCarton,
            nombreEsCarton, envaseEsCarton, qtyEsCarton,
            esCarton, montoItem
          });

          // Separación estricta: un producto frío es O pieza suelta O cartón, nunca ambos
          if (esCarton) {
            cartonesFriosCant += qty;
            cartonesFriosMonto += montoItem;
          } else {
            piezasFriasCant += qty;
            piezasFriasMonto += montoItem;
          }
        });
      });

      console.log('EmailJS >> totales fríos:', {
        piezasFriasCant, piezasFriasMonto,
        cartonesFriosCant, cartonesFriosMonto
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

      // ---------- Cálculo de promociones desde transacciones del corte ----------
      // Fuente idéntica a la vista de Reportes (js/reports.js): suma de
      // item.promoVolumenAplicada.precio sobre cada ítem de cada transacción del turno.
      let promocionesCant = 0;
      let promocionesMonto = 0;
      let promocionesPiezas = 0;

      (corte.transacciones || []).forEach(ticket => {
        (ticket.items || []).forEach(item => {
          if (!item) return;
          const promo = item.promoVolumenAplicada;
          if (promo && Number(promo.precio || 0) > 0) {
            promocionesMonto += Number(promo.precio);
            promocionesCant += 1;
            promocionesPiezas += Number(promo.cantidad || item.cantidad || 1);
          }
        });
      });

      promocionesMonto = this.round2(promocionesMonto);

      // Fallback: si el corte tiene descuentosPromociones consolidado pero no hay
      // desglose por ítems, usar el valor consolidado del turno
      const descuentosPromocionesRaw = Number(corte.descuentosPromociones || 0);
      if (promocionesMonto === 0 && descuentosPromocionesRaw > 0) {
        promocionesMonto = this.round2(descuentosPromocionesRaw);
        promocionesCant = 1;
      }

      console.log('EmailJS >> totales promociones:', {
        promocionesCant, promocionesMonto, promocionesPiezas
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
        piezas_frias_cant: piezasFriasCant,
        piezas_frias_monto: this.round2(piezasFriasMonto),
        cartones_frios_cant: cartonesFriosCant,
        cartones_frios_monto: this.round2(cartonesFriosMonto),
        promociones_cant: promocionesCant,
        promociones_monto: this.round2(promocionesMonto),

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
        piezas_frias_monto: this.round2(piezasFriasMonto),
        cartones_frios_monto: this.round2(cartonesFriosMonto),
        promociones_monto: this.round2(promocionesMonto)
      });

      // Enviar el correo
      const response = await emailjs.send(
        this.config.serviceId,
        this.config.templateId,
        templateParams,
        this.config.publicKey
      );

      console.log('Email de respaldo enviado correctamente:', response);
      return { success: true, response };
    } catch (error) {
      console.error('Error al enviar el email de respaldo:', error);
      return { success: false, error: error.message || error };
    }
  },

  /**
   * Configura las credenciales de EmailJS.
   * @param {Object} creds - Objeto con publicKey, serviceId y templateId.
   */
  setConfig(creds) {
    if (creds.publicKey) this.config.publicKey = creds.publicKey;
    if (creds.serviceId) this.config.serviceId = creds.serviceId;
    if (creds.templateId) this.config.templateId = creds.templateId;
  }
};

// Exportar para su uso en otros módulos
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EmailService;
}