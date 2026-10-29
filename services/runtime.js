// La vista de prueba usa memoria. Carga la única semilla de pruebas; no modifica el inventario real.
const DemoMode = new URLSearchParams(location.search).get('demo') === '1';
const AppStorage = DemoMode ? (()=>{const values=new Map();return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};})() : localStorage;
const Demo = {
  init() {
    if(!DemoMode || document.querySelector('.demo-banner')) return;
    const banner=document.createElement('div');banner.className='demo-banner';banner.textContent='PRUEBAS · Mega Corona · Solo memoria';const reset=document.createElement('button');reset.type='button';reset.className='demo-reset';reset.textContent='Reiniciar';reset.setAttribute('aria-label','Reiniciar los datos de prueba');reset.onclick=()=>location.reload();banner.appendChild(reset);document.body.appendChild(banner);
  }
};
