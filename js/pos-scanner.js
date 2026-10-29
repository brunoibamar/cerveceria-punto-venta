// Escáner y búsqueda por código de barras.
Object.assign(POS, {
  // ---------- Escáner ----------

  findProductByBarcode(barcode) {
    if (!barcode) return null;
    const code = barcode.toString().trim();
    const products = Database.getProducts();
    const matches = products.filter(p => {
      if(p.activo===false)return false;
      const b1 = p.codigoBarras && p.codigoBarras.toString().trim();
      const b2 = p.codigo && p.codigo.toString().trim();
      return (b1 && b1 === code) || (b2 && b2 === code);
    });
    this.scannerBarcodeConflict=matches.length>1;
    return matches.length===1?matches[0]:null;
  },

  addProductByBarcode(barcode) {
    const product = this.findProductByBarcode(barcode);
    if (!product) {
      this.setScannerStatus(this.scannerBarcodeConflict?'Ese código pertenece a varios productos. Corrige los códigos en Inventario.':'Código no encontrado: ' + barcode);
      return null;
    }

    const isCold = Boolean(this.piezaFriaGlobal);
    const hasStock = (product.stock || 0) > 0;
    const hasCold = isCold && (Number(product.coldStock) || 0) > 0;

    if (product.activo === false || (!hasStock && !hasCold)) {
      this.setScannerStatus('Producto sin stock o inactivo: ' + product.nombre);
      return null;
    }

    this.addToCart(product.id);
    this.setScannerStatus('Agregado: ' + product.nombre + (isCold ? ' (frío ❄️)' : ''));
    return product;
  },

  openCameraScanner() {
    const modal = document.getElementById('pos-scanner-modal');
    if (!modal) return;

    modal.classList.add('active');
    this.initScannerModal();
    const continuousCheckbox = document.getElementById('pos-scanner-continuous');
    if (continuousCheckbox) {
      this.scanner.isContinuous = continuousCheckbox.checked;
    }

    setTimeout(() => {
      this.startCameraScanner();
    }, 50);
  },

  closeCameraScanner() {
    this.stopCameraScanner();
    const modal = document.getElementById('pos-scanner-modal');
    if (modal) {
      modal.classList.remove('active');
    }
  },

  toggleCameraScanner() {
    if (this.scanner.isScanning) {
      this.stopCameraScanner();
    } else {
      this.startCameraScanner();
    }
  },

  setScannerStatus(text) {
    const statusEl = document.getElementById('pos-scanner-status');
    if (statusEl) {
      statusEl.textContent = text;
    }
  },

  async startCameraScanner() {
    if (this.scanner.isScanning) return;

    const videoElement = document.getElementById('pos-scanner-video');
    if (!videoElement) {
      this.setScannerStatus('No se encontró el elemento de video');
      return;
    }
    this.scanner.videoElement = videoElement;

    const toggleBtn = document.getElementById('pos-scanner-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = 'Detener';
    }

    try {
      const generation=this.scanner.generation=(this.scanner.generation||0)+1;
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: {ideal:'environment'},width:{ideal:1920},height:{ideal:1080} },audio:false });
      if(this.scanner.generation!==generation){stream.getTracks().forEach(t=>t.stop());return;}
      this.scanner.stream = stream;
      videoElement.srcObject = stream;
      await videoElement.play();
      if(this.scanner.generation!==generation){stream.getTracks().forEach(t=>t.stop());return;}

      this.scanner.isScanning = true;
      this.scanner.lastScanned = '';
      this.scanner.lastScannedTime = 0;
      this.setScannerStatus('Cámara activa. Apunta al código de barras...');

      await this.initCodeReader();
    } catch (error) {
      console.error('Error al iniciar cámara:', error);
      this.setScannerStatus('Error al acceder a la cámara: ' + error.message);
      if (toggleBtn) {
        toggleBtn.textContent = 'Iniciar';
      }
    }
  },

  stopCameraScanner() {
    this.scanner.generation=(this.scanner.generation||0)+1;
    this.scanner.isScanning = false;

    if (this.scanner.stream) {
      this.scanner.stream.getTracks().forEach(track => track.stop());
      this.scanner.stream = null;
    }

    if (this.scanner.videoElement) {
      this.scanner.videoElement.srcObject = null;
    }

    if (this.scanner.codeReader) {
      try {
        this.scanner.codeReader.reset();
      } catch (e) {}
    }

    const toggleBtn = document.getElementById('pos-scanner-toggle');
    if (toggleBtn) {
      toggleBtn.textContent = 'Iniciar';
    }
    this.setScannerStatus('Cámara detenida');
  },

  async initCodeReader() {
    const { BrowserMultiFormatReader } = window.ZXing || {};
    if (!BrowserMultiFormatReader) {
      this.setScannerStatus('Librería ZXing no cargada. Agrega el script de ZXing a index.html');
      this.stopCameraScanner();
      return;
    }

    if (this.scanner.codeReader) {
      try {
        this.scanner.codeReader.reset();
      } catch (e) {}
    }

    try {
    this.scanner.codeReader = ScannerEngine.scan(this.scanner.videoElement,this.scanner.stream,(result) => {
        if (result) {
          const code = result.getText();
          const now = Date.now();
          if (this.scanner.isContinuous) {
            if (code === this.scanner.lastScanned && (now - this.scanner.lastScannedTime) < this.scanner.debounceMs) {
              return;
            }
            this.scanner.lastScanned = code;
            this.scanner.lastScannedTime = now;
            this.addProductByBarcode(code);
          } else {
            this.scanner.lastScanned = code;
            this.scanner.lastScannedTime = now;
            this.addProductByBarcode(code);
            this.closeCameraScanner();
          }
        }
      });
    } catch (error) {
      console.error(error);
      this.setScannerStatus('Error al iniciar lector de códigos: ' + error.message);
    }
  },


});
