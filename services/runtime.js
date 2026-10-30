// La vista de prueba usa memoria. Carga la única semilla de pruebas; no modifica el inventario real.
const DemoMode = new URLSearchParams(location.search).get('demo') === '1';
const ProductionMode = new URLSearchParams(location.search).get('env') === 'production';
if(ProductionMode){const manifest=document.querySelector('link[rel="manifest"]');if(manifest)manifest.href='manifest-production.json';}
const AppStorage = DemoMode ? (()=>{const values=new Map();return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};})() : ProductionMode ? {
  getItem:key=>localStorage.getItem('production:'+key),
  setItem:(key,value)=>localStorage.setItem('production:'+key,String(value)),
  removeItem:key=>localStorage.removeItem('production:'+key)
} : localStorage;
const Demo = {
  init() {
    if(!DemoMode && !document.getElementById('environment-label')) {
      const label=document.createElement('div');label.id='environment-label';label.className='environment-label';
      label.textContent=ProductionMode?'NEGOCIO REAL':'PRUEBAS · Datos separados del negocio real';
      document.body.prepend(label);
    }
    if(!DemoMode || document.querySelector('.demo-banner')) return;
    const banner=document.createElement('div');banner.className='demo-banner';banner.textContent='PRUEBAS · Mega Corona · Solo memoria';const reset=document.createElement('button');reset.type='button';reset.className='demo-reset';reset.textContent='Reiniciar';reset.setAttribute('aria-label','Reiniciar los datos de prueba');reset.onclick=()=>location.reload();banner.appendChild(reset);document.body.appendChild(banner);
  }
};
