export function openScannerModal(options = {}) {
  const {
    title = '📷 Lector de Código de Barras',
    onScan,
    onClose,
    placeholder = 'Código de barras o nombre',
    videoConstraints = { facingMode: 'environment' },
    formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
    scanInterval = 400,
  } = options;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'scanner-modal';
  overlay.innerHTML = `
    <div class="card scanner-modal" role="dialog" aria-modal="true" aria-label="Escáner de código de barras">
      <h3 class="scanner-title">${title}</h3>
      <div class="scanner-viewport">
        <video class="scanner-video" id="scanner-video" autoplay playsinline muted></video>
        <p class="scanner-status" id="scanner-status">Iniciando cámara…</p>
      </div>
      <label class="field">
        <span>O ingresa el código / nombre manualmente</span>
        <input class="input" id="scanner-manual" type="search" placeholder="${placeholder}" autocomplete="off">
      </label>
      <div class="scanner-actions">
        <button class="btn btn--block" id="scanner-find" type="button">Buscar producto</button>
        <button class="btn btn--ghost btn--block" id="scanner-close" type="button">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('#scanner-video');
  const statusEl = overlay.querySelector('#scanner-status');
  const manual = overlay.querySelector('#scanner-manual');
  let stream = null;
  let detectTimer = null;
  let closed = false;

  function stopCamera() {
    if (detectTimer) {
      clearInterval(detectTimer);
      detectTimer = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  function close() {
    closed = true;
    stopCamera();
    overlay.remove();
    if (onClose) onClose();
  }

  function handleScan(value) {
    if (onScan && onScan(value)) {
      close();
      return true;
    }
    return false;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      statusEl.textContent = 'Cámara no disponible. Ingresa el código manualmente.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      if (closed) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      if ('BarcodeDetector' in window) {
        const detector = new BarcodeDetector({ formats });
        statusEl.textContent = 'Cámara activa: apunta al código de barras';
        detectTimer = setInterval(async () => {
          if (closed || !stream) return;
          try {
            const barcodes = await detector.detect(video);
            if (barcodes && barcodes.length && barcodes[0].rawValue) {
              handleScan(barcodes[0].rawValue);
            }
          } catch {
          }
        }, scanInterval);
      } else {
        statusEl.textContent = 'Este navegador no soporta detección automática. Ingresa el código manualmente.';
      }
    } catch {
      statusEl.textContent = 'Sin acceso a la cámara (permiso denegado o cámara inexistente). Ingresa el código manualmente.';
    }
  }

  overlay.querySelector('#scanner-close').addEventListener('click', close);
  overlay.querySelector('#scanner-find').addEventListener('click', () => {
    handleScan(manual.value);
  });
  manual.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleScan(manual.value);
    }
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  startCamera();
}