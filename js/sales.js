// Opciones de cobro con tarjeta de Mercado Pago para el modal de venta
// Paleta "Midnight & Amber": fondo #12100E, tarjetas #1C1815, acento #E0A96D
//
// Al elegir la pestaña "Tarjeta" o "Transferencia" el modal de cobro muestra
// tres formas de cobro y el cajero elige una:
//   📱 NFC / Contactless (Tap to Pay) -> abre la app de Mercado Pago y lee etiquetas NFC
//   🔳 Cobrar con Código QR            -> dibuja el QR de cobro en el propio dispositivo
//   💳 Terminal física / Registro      -> la terminal de Mercado Pago cobra y el cajero registra
//
// Todo el módulo funciona sin conexión: el QR se dibuja en el dispositivo con
// un generador propio, sin depender de un CDN ni de un servicio externo.

/* ------------------------------------------------------------------
   Apertura directa de la app de Mercado Pago (Android)
   Se expone como función global para poder engancharla directamente a los
   botones del modal (#btn-open-mp-app y #btn-read-nfc) sin intermediarios.
   ------------------------------------------------------------------ */

// Monto del cobro en curso, para viajar en el intent de la app
function obtenerMontoCobro() {
  try {
    if (typeof SalesPayment !== 'undefined' && SalesPayment.lastContext
      && typeof SalesPayment.lastContext.total !== 'undefined') {
      return Number(SalesPayment.lastContext.total) || 0;
    }
    if (typeof window !== 'undefined' && window.cartTotal !== undefined) {
      return Number(window.cartTotal) || 0;
    }
  } catch (error) {
    // ignore
  }
  return 0;
}

function abrirMercadoPagoLimpio() {
  // Esquema directo de la aplicación instalada, sin redirección a Play Store
  window.location.href = "mercadopago://";
}

function abrirMercadoPagoDirecto(monto) {
  const amount = Number(monto);
  const amountStr = (isNaN(amount) ? obtenerMontoCobro() : amount).toFixed(2);

  // Uso el esquema directo puro para evitar que el navegador abra Play Store
  window.location.href = "mercadopago://";
}

/* ------------------------------------------------------------------
   Generador de códigos QR (modo byte, nivel de corrección de errores M)
   Implementación propia y sin dependencias: arma la matriz del símbolo
   aplicando los patrones de función, la corrección Reed-Solomon y las
   ocho máscaras del estándar ISO/IEC 18004.
   ------------------------------------------------------------------ */
const QrCode = {
  // Nivel de corrección: 0 = M (15% de recuperación)
  ECC_LEVEL: 0,

  // Palabras de código de datos totales por versión (versiones 1 a 20)
  TOTAL_CODEWORDS: [26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085],

  // Bits sobrantes por versión (no forman parte de ninguna palabra de datos)
  REMAINDER_BITS: [0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3],

  // Palabras de corrección de errores por bloque (nivel M)
  ECC_PER_BLOCK: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26],

  // Número de bloques de corrección de errores (nivel M)
  BLOCKS: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16],

  // Coordenadas de los patrones de alineación por versión
  ALIGN_POS: [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
    [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90]
  ],

  // Multiplicación en el campo de Galois (polinomio 0x11D)
  gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  },

  // Polinomio divisor de Reed-Solomon del grado indicado
  rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = this.gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = this.gfMul(root, 0x02);
    }
    return result;
  },

  // Resto de la división de Reed-Solomon (palabras de corrección)
  rsRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (let i = 0; i < data.length; i++) {
      const factor = (data[i] ^ result[0]) & 0xFF;
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let j = 0; j < result.length; j++) {
        result[j] ^= this.gfMul(divisor[j], factor);
      }
    }
    return result;
  },

  // Palabras de datos disponibles en una versión con nivel M
  dataCodewords(version) {
    const index = version - 1;
    return this.TOTAL_CODEWORDS[index] - this.ECC_PER_BLOCK[index] * this.BLOCKS[index];
  },

  // Bits del indicador de cantidad de caracteres (modo byte)
  charCountBits(version) {
    return version <= 9 ? 8 : 16;
  },

  // Convierte el texto a una lista de bytes UTF-8
  toUtf8(text) {
    const str = String(text === undefined || text === null ? '' : text);
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return bytes;
  },

  // Arma las palabras de datos (modo byte) con terminador y bytes de relleno
  buildCodewords(bytes, version) {
    const capacity = this.dataCodewords(version) * 8;
    const bits = [];

    const push = (value, length) => {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };

    push(0b0100, 4); // indicador de modo byte
    push(bytes.length, this.charCountBits(version));
    bytes.forEach(byte => push(byte, 8));

    // Terminador de hasta cuatro ceros
    const terminator = Math.min(4, capacity - bits.length);
    for (let i = 0; i < terminator; i++) bits.push(0);

    // Relleno hasta el límite del byte
    while (bits.length % 8 !== 0) bits.push(0);

    const codewords = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      codewords.push(byte);
    }

    // Bytes de relleno alternos 0xEC / 0x11
    let pad = 0xEC;
    while (codewords.length < this.dataCodewords(version)) {
      codewords.push(pad);
      pad = (pad === 0xEC) ? 0x11 : 0xEC;
    }

    return codewords;
  },

  // Divide en bloques, calcula la corrección de errores e intercala
  interleave(data, version) {
    const index = version - 1;
    const numBlocks = this.BLOCKS[index];
    const eccLength = this.ECC_PER_BLOCK[index];
    const totalData = this.dataCodewords(version);
    const numShortBlocks = numBlocks - (totalData % numBlocks);
    const shortLength = Math.floor(totalData / numBlocks);

    const divisor = this.rsDivisor(eccLength);
    const dataBlocks = [];
    const eccBlocks = [];
    let offset = 0;

    for (let i = 0; i < numBlocks; i++) {
      const length = shortLength + (i < numShortBlocks ? 0 : 1);
      const block = data.slice(offset, offset + length);
      offset += length;
      dataBlocks.push(block);
      eccBlocks.push(this.rsRemainder(block, divisor));
    }

    const result = [];
    let maxLength = 0;
    dataBlocks.forEach(block => { if (block.length > maxLength) maxLength = block.length; });

    for (let i = 0; i < maxLength; i++) {
      for (let b = 0; b < numBlocks; b++) {
        if (i < dataBlocks[b].length) result.push(dataBlocks[b][i]);
      }
    }
    for (let i = 0; i < eccLength; i++) {
      for (let b = 0; b < numBlocks; b++) result.push(eccBlocks[b][i]);
    }

    return result;
  },

  // Patrón localizador 7x7 con su separador claro
  drawFinder(setFn, cx, cy, size) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  },

  // Patrón de alineación 5x5
  drawAlignment(setFn, cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  },

  // Información de formato (nivel de corrección + máscara) en sus dos copias
  drawFormat(setFn, mask, size) {
    const data = (this.ECC_LEVEL << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = index => ((bits >>> index) & 1) !== 0;

    for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));

    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
    setFn(8, size - 8, true); // módulo siempre oscuro
  },

  // Información de versión (solo a partir de la versión 7)
  drawVersion(setFn, version, size) {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (version << 12) | rem;
    const bit = index => ((bits >>> index) & 1) !== 0;

    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit(i));
      setFn(b, a, bit(i));
    }
  },

  // Aplica (o revierte) una de las ocho máscaras
  applyMask(modules, isFunction, mask, size) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0; break;
        }
        if (invert) modules[y][x] = !modules[y][x];
      }
    }
  },

  // Registro de corridas para detectar el patrón 1:1:3:1:1
  finderAddHistory(runLength, history, size) {
    if (history[0] === 0) runLength += size; // borde claro inicial
    history.pop();
    history.unshift(runLength);
  },

  finderCount(history) {
    const n = history[1];
    const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
    return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0)
      + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
  },

  finderTerminate(runColor, runLength, history, size) {
    if (runColor) {
      this.finderAddHistory(runLength, history, size);
      runLength = 0;
    }
    runLength += size; // borde claro final
    this.finderAddHistory(runLength, history, size);
    return this.finderCount(history);
  },

  // Penalización del símbolo: la máscara con menor penalización es la más legible
  penalty(modules, size) {
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    let result = 0;

    for (let axis = 0; axis < 2; axis++) {
      for (let line = 0; line < size; line++) {
        let runColor = false;
        let runLength = 0;
        const history = [0, 0, 0, 0, 0, 0, 0];
        for (let pos = 0; pos < size; pos++) {
          const color = axis === 0 ? modules[line][pos] : modules[pos][line];
          if (color === runColor) {
            runLength++;
            if (runLength === 5) result += N1;
            else if (runLength > 5) result++;
          } else {
            this.finderAddHistory(runLength, history, size);
            if (!runColor) result += this.finderCount(history) * N3;
            runColor = color;
            runLength = 1;
          }
        }
        result += this.finderTerminate(runColor, runLength, history, size) * N3;
      }
    }

    // Bloques de 2x2 con el mismo color
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = modules[y][x];
        if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) result += N2;
      }
    }

    // Balance entre módulos oscuros y claros
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y][x]) dark++;
      }
    }
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * N4;

    return result;
  },

  // Construye la matriz completa del símbolo
  buildMatrix(codewords, version) {
    const size = version * 4 + 17;
    const modules = [];
    const isFunction = [];
    for (let i = 0; i < size; i++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }

    const setFn = (x, y, dark) => {
      modules[y][x] = dark;
      isFunction[y][x] = true;
    };

    // Patrones de sincronización
    for (let i = 0; i < size; i++) {
      setFn(6, i, i % 2 === 0);
      setFn(i, 6, i % 2 === 0);
    }

    // Patrones localizadores con separadores
    this.drawFinder(setFn, 3, 3, size);
    this.drawFinder(setFn, size - 4, 3, size);
    this.drawFinder(setFn, 3, size - 4, size);

    // Patrones de alineación (excepto las tres esquinas de los localizadores)
    const positions = this.ALIGN_POS[version - 1];
    const last = positions.length - 1;
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        const overlapsFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (overlapsFinder) continue;
        this.drawAlignment(setFn, positions[i], positions[j]);
      }
    }

    // Áreas reservadas de formato y versión
    this.drawFormat(setFn, 0, size);
    this.drawVersion(setFn, version, size);

    // Colocación de los datos en zigzag
    const all = this.interleave(codewords, version);
    let bit = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bit < all.length * 8) {
            modules[y][x] = ((all[bit >>> 3] >>> (7 - (bit & 7))) & 1) !== 0;
            bit++;
          }
        }
      }
    }

    // Se prueba cada máscara y se conserva la de menor penalización
    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(modules, isFunction, mask, size);
      this.drawFormat(setFn, mask, size);
      const score = this.penalty(modules, size);
      if (score < bestPenalty) {
        bestPenalty = score;
        bestMask = mask;
      }
      this.applyMask(modules, isFunction, mask, size); // la máscara es su propia inversa
    }
    this.applyMask(modules, isFunction, bestMask, size);
    this.drawFormat(setFn, bestMask, size);

    return { size: size, modules: modules };
  },

  // Codifica el texto y devuelve la matriz de módulos
  encode(text) {
    const bytes = this.toUtf8(text);
    let version = 0;
    for (let v = 1; v <= this.TOTAL_CODEWORDS.length; v++) {
      const used = 4 + this.charCountBits(v) + bytes.length * 8;
      if (used <= this.dataCodewords(v) * 8) {
        version = v;
        break;
      }
    }
    if (!version) throw new Error('El contenido es demasiado largo para un código QR.');

    const codewords = this.buildCodewords(bytes, version);
    return this.buildMatrix(codewords, version);
  },

  // Devuelve el QR como SVG listo para insertar en el DOM
  toSvg(text, options) {
    const opts = options || {};
    const qr = this.encode(text);
    const quiet = opts.quiet === undefined ? 4 : opts.quiet;
    const dimension = qr.size + quiet * 2;

    let path = '';
    for (let y = 0; y < qr.size; y++) {
      let x = 0;
      while (x < qr.size) {
        if (!qr.modules[y][x]) {
          x++;
          continue;
        }
        let run = 1;
        while (x + run < qr.size && qr.modules[y][x + run]) run++;
        path += 'M' + (x + quiet) + ' ' + (y + quiet) + 'h' + run + 'v1h-' + run + 'z';
        x += run;
      }
    }

    const dark = opts.dark || '#12100E';
    const light = opts.light || '#FAF4EE';
    const label = opts.label || 'Código QR de cobro';

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dimension + ' ' + dimension + '" '
      + 'shape-rendering="crispEdges" role="img" aria-label="' + label + '">'
      + '<rect width="' + dimension + '" height="' + dimension + '" fill="' + light + '"/>'
      + '<path d="' + path + '" fill="' + dark + '"/>'
      + '</svg>';
  }
};

/* ------------------------------------------------------------------
   Opciones de cobro con tarjeta de Mercado Pago
   ------------------------------------------------------------------ */
const SalesPayment = {
  // Las tres formas de cobro con tarjeta
  CHANNELS: {
    nfc: {
      id: 'nfc',
      icon: '📱',
      name: 'NFC / Contactless',
      desc: 'Tap to Pay con la app',
      short: 'NFC'
    },
    qr: {
      id: 'qr',
      icon: '🔳',
      name: 'Cobrar con QR',
      desc: 'Muestra el código de cobro',
      short: 'QR'
    },
    terminal: {
      id: 'terminal',
      icon: '💳',
      name: 'Terminal física',
      desc: 'Registro directo del cajero',
      short: 'Terminal'
    }
  },

  // Orden en que se muestran los botones
  ORDER: ['nfc', 'qr', 'terminal'],

  // Canal con el que arranca el cobro (el más tradicional, no requiere nada extra)
  DEFAULT_CHANNEL: 'terminal',

  // App de Mercado Pago (deep link) y respaldo web
  MP_APP_URL: 'mercadopago://',
  MP_WEB_URL: 'https://www.mercadopago.com.mx/',

  // Estado de la lectura NFC en curso
  nfc: {
    reader: null,
    status: 'idle',
    message: ''
  },

  // Cache del QR ya dibujado para no recalcularlo en cada repintado
  qrCache: {
    payload: '',
    svg: ''
  },

  // Etiqueta corta del canal (NFC, QR o Terminal)
  getChannelLabel(channel) {
    const meta = this.CHANNELS[channel];
    return meta ? meta.short : '';
  },

  // Nombre completo del canal
  getChannelName(channel) {
    const meta = this.CHANNELS[channel];
    return meta ? meta.name : '';
  },

  // Normaliza el canal elegido
  normalizeChannel(channel) {
    const value = String(channel || '').toLowerCase();
    return this.CHANNELS[value] ? value : this.DEFAULT_CHANNEL;
  },

  // Reinicia el estado del módulo (se llama al abrir el modal de cobro)
  reset() {
    this.stopNfc();
    this.nfc.status = 'idle';
    this.nfc.message = '';
    this.qrCache.payload = '';
    this.qrCache.svg = '';
    this.renderSignature = '';
  },

  // Configuración guardada en Ajustes
  getSettings() {
    try {
      if (typeof Database !== 'undefined' && Database.getSettings) return Database.getSettings() || {};
    } catch (error) {
      console.warn('[SalesPayment] No se pudo leer la configuración:', error);
    }
    return {};
  },

  // Arma el contenido del código QR de cobro.
  // Si el negocio configuró su link de Mercado Pago se usa esa plantilla
  // (admite {amount}, {currency}, {reference} y {folio}); si no, se genera
  // una referencia local del cobro.
  buildPayload(ctx) {
    const context = ctx || {};
    const total = Number(context.total) || 0;
    const currency = context.currency || '$';
    const reference = context.reference || this.buildReference();
    const folio = context.folio || reference;

    const template = String(this.getSettings().mercadoPagoCobroUrl || '').trim();
    if (template) {
      return template
        .replace(/\{amount\}/gi, total.toFixed(2))
        .replace(/\{currency\}/gi, currency)
        .replace(/\{reference\}/gi, reference)
        .replace(/\{folio\}/gi, folio);
    }

    return 'MP-POS|1|' + reference + '|' + total.toFixed(2) + '|' + currency;
  },

  // Referencia corta y única del cobro
  buildReference() {
    const now = new Date();
    const stamp = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + '-' + now.getTime().toString(36).toUpperCase().slice(-5);
    return 'MP' + stamp;
  },

  // Dibuja el QR del cobro (reutiliza el último si el contenido no cambió)
  renderQr(payload, label) {
    if (this.qrCache.payload !== payload) {
      try {
        this.qrCache.svg = QrCode.toSvg(payload, { label: label || 'Código QR de cobro' });
        this.qrCache.payload = payload;
      } catch (error) {
        console.error('[SalesPayment] No se pudo generar el código QR:', error);
        this.qrCache.svg = '';
        this.qrCache.payload = payload;
      }
    }
    return this.qrCache.svg;
  },

  // Renderiza los tres botones y el panel del canal elegido
  render(ctx) {
    const host = document.getElementById('pos-pay-card-options');
    if (!host) return;

    const context = ctx || {};
    this.lastContext = context;
    const selected = this.normalizeChannel(context.channel);

    // Se evita repintar cuando nada cambio (por ejemplo, al teclear el efectivo)
    const signature = [selected, context.total, context.currency, context.reference].join('|');
    if (this.renderSignature === signature && host.innerHTML) {
      this.syncNfcStatus();
      return;
    }
    this.renderSignature = signature;

    const buttons = this.ORDER.map(id => {
      const meta = this.CHANNELS[id];
      const active = id === selected;
      return '<button type="button" class="pay-channel' + (active ? ' is-active' : '') + '" '
        + 'data-card-option="' + id + '" role="radio" aria-checked="' + (active ? 'true' : 'false') + '">'
        + '<span class="pay-channel-icon" aria-hidden="true">' + meta.icon + '</span>'
        + '<span class="pay-channel-name">' + meta.name + '</span>'
        + '<span class="pay-channel-desc">' + meta.desc + '</span>'
        + '</button>';
    }).join('');

    host.innerHTML = '<span class="pay-card-options-title">Cobro con Mercado Pago</span>'
      + '<div class="pay-card-options-grid" role="radiogroup" aria-label="Forma de cobro con tarjeta">' + buttons + '</div>'
      + '<div class="pay-card-panel">' + this.buildPanel(selected, context) + '</div>';

    this.bindDirectActions();
  },

  // Engancha los botones de la app de Mercado Pago directamente al elemento.
  // El listener se registra sobre el botón (y no por delegación en el modal)
  // para que la navegación ocurra dentro del mismo gesto del usuario: sin
  // setTimeout el navegador no la bloquea por política de seguridad.
bindDirectActions() {
    const btnApp = document.getElementById('btn-open-mp-app');
    if (btnApp) {
      btnApp.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        abrirMercadoPagoLimpio();
      });
    }

    const btnNfc = document.getElementById('btn-read-nfc');
    if (btnNfc) {
      btnNfc.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.leerNfcYAbrirApp(window.cartTotal);
      });
    }
  },

  // Panel con las instrucciones del canal elegido
  buildPanel(channel, ctx) {
    const context = ctx || {};
    const total = Number(context.total) || 0;
    const currency = context.currency || '$';
    const amount = currency + total.toFixed(2);

    if (channel === 'nfc') {
      return '<div class="pay-card-panel-body">'
        + '<p class="pay-card-text">Acerca el teléfono a la etiqueta NFC o abre la app de Mercado Pago para cobrar con Tap to Pay.</p>'
        + '<div class="pay-card-actions">'
        + '<button type="button" class="pay-card-btn primary" id="btn-read-nfc" data-card-action="nfc-scan">📡 Leer NFC</button>'
        + '<button type="button" class="pay-card-btn" id="btn-open-mp-app" data-card-action="open-app">📱 Abrir app</button>'
        + '</div>'
        + '<p class="pay-card-note" style="font-size:0.75rem;color:#666;margin-top:6px;">El cobro NFC (Tap to Pay) se procesa directamente dentro de la app oficial de Mercado Pago</p>'
        + '<p class="pay-card-status" id="pos-pay-nfc-status">' + this.escapeHtml(this.nfc.message) + '</p>'
        + '<p class="pay-card-fallback"><a href="' + this.MP_WEB_URL + '" target="_blank" rel="noopener">¿No tienes la app? Abre Mercado Pago en el navegador</a></p>'
        + '</div>';
    }

    if (channel === 'qr') {
      const payload = this.buildPayload(context);
      const svg = this.renderQr(payload, 'Código QR de cobro de ' + amount);
      const configured = !!String(this.getSettings().mercadoPagoCobroUrl || '').trim();
      return '<div class="pay-card-panel-body">'
        + '<div class="pay-qr">'
        + '<div class="pay-qr-frame">' + svg + '</div>'
        + '<div class="pay-qr-info">'
        + '<span class="pay-qr-amount">' + amount + '</span>'
        + '<span class="pay-qr-label">Escanea con la app de Mercado Pago</span>'
        + '<span class="pay-qr-note">' + (configured
          ? 'El código apunta a tu link de cobro configurado en Ajustes.'
          : 'Configura tu link de cobro en Ajustes → Mercado Pago para cobrar directo a tu cuenta.') + '</span>'
        + '</div>'
        + '</div>'
        + '</div>';
    }

    return '<div class="pay-card-panel-body">'
      + '<p class="pay-card-text">Cobra <strong>' + amount + '</strong> en la terminal de Mercado Pago y registra la venta aquí.</p>'
      + '<ol class="pay-card-steps">'
      + '<li>Cobra el total en la terminal de Mercado Pago.</li>'
      + '<li>Verifica el voucher y el monto cobrado.</li>'
      + '<li>Pulsa "Confirmar Pago" para registrar la venta.</li>'
      + '</ol>'
      + '</div>';
  },

  // Acciones del panel (leer NFC, abrir la app de Mercado Pago)
  handleAction(action) {
    if (action === 'nfc-scan') {
      this.leerNfcYAbrirApp();
      return;
    }
    if (action === 'open-app') {
      this.openMercadoPago(window.cartTotal);
    }
  },

  // Abre la app instalada de Mercado Pago sin abandonar el punto de venta.
  // El intent se asigna dentro del gesto del usuario (sin setTimeout) para que
  // Android intercepte el esquema y el navegador no lo bloquee.
  openMercadoPago(monto) {
    try {
      const amount = Number(monto);
      // Uso el esquema directo puro para evitar que el navegador abra Play Store
      window.location.href = "mercadopago://";
    } catch (error) {
      console.warn('[SalesPayment] No se pudo abrir la app de Mercado Pago:', error);
    }
  },

  // Botón "Leer NFC": intenta la lectura con Web NFC y abre la app instalada
  // de Mercado Pago (Tap to Pay) con el intent oficial de Android.
  leerNfcYAbrirApp(monto) {
    const soportaWebNfc = typeof window !== 'undefined' && 'NDEFReader' in window;

    if (soportaWebNfc) {
      this.startNfc();
    } else {
      this.nfc.status = 'error';
      this.nfc.message = 'Este dispositivo no puede leer NFC. Usa el código QR o la terminal física.';
      this.updateNfcStatus();
    }

    this.openMercadoPago(typeof monto !== 'undefined' ? monto : window.cartTotal);
  },

  // Inicia la lectura de una etiqueta NFC (Web NFC: Chrome en Android)
  startNfc() {
    if (typeof window === 'undefined' || !('NDEFReader' in window)) {
      this.nfc.status = 'error';
      this.nfc.message = 'Este dispositivo no puede leer NFC. Usa el código QR o la terminal física.';
      this.updateNfcStatus();
      return;
    }

    this.stopNfc();
    this.nfc.status = 'reading';
    this.nfc.message = 'Acerca el teléfono a la etiqueta NFC…';
    this.updateNfcStatus();

    try {
      const reader = new window.NDEFReader();
      this.nfc.reader = reader;

      reader.onreading = event => {
        let text = '';
        try {
          const decoder = new TextDecoder();
          const records = (event && event.message && event.message.records) || [];
          records.forEach(record => {
            if (record.recordType === 'text') text += decoder.decode(record.data);
          });
        } catch (error) {
          text = '';
        }

        this.nfc.status = 'ok';
        this.nfc.message = text ? 'Lectura NFC: ' + text : 'Etiqueta NFC leída correctamente.';
        this.updateNfcStatus();
        this.stopNfc();
      };

      reader.onerror = error => {
        this.nfc.status = 'error';
        this.nfc.message = 'No se pudo leer la etiqueta NFC. Intenta de nuevo.';
        console.warn('[SalesPayment] Error de lectura NFC:', error);
        this.updateNfcStatus();
        this.stopNfc();
      };

      reader.scan().catch(error => {
        this.nfc.status = 'error';
        this.nfc.message = 'No se pudo iniciar la lectura NFC: revisa los permisos del navegador.';
        console.warn('[SalesPayment] No se pudo iniciar el escáner NFC:', error);
        this.updateNfcStatus();
        this.stopNfc();
      });
    } catch (error) {
      this.nfc.status = 'error';
      this.nfc.message = 'No se pudo iniciar la lectura NFC en este dispositivo.';
      console.warn('[SalesPayment] NFC no disponible:', error);
      this.updateNfcStatus();
    }
  },

  // Detiene la lectura NFC en curso
  stopNfc() {
    if (this.nfc.reader) {
      try {
        this.nfc.reader = null;
      } catch (error) {
        console.warn('[SalesPayment] No se pudo detener la lectura NFC:', error);
      }
    }
  },

  // Refleja el estado de la lectura NFC en el panel
  updateNfcStatus() {
    const status = document.getElementById('pos-pay-nfc-status');
    if (!status) return;
    status.textContent = this.nfc.message;
    status.classList.remove('is-error', 'is-ok');
    if (this.nfc.status === 'error') status.classList.add('is-error');
    if (this.nfc.status === 'ok') status.classList.add('is-ok');
  },

  // Vuelve a pintar el mensaje de NFC sin rehacer todo el panel
  syncNfcStatus() {
    if (this.nfc.status === 'idle' && !this.nfc.message) return;
    this.updateNfcStatus();
  },

  // Escapa texto para insertarlo como HTML
  escapeHtml(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};
