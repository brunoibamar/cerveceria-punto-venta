// NIP local: hash PBKDF2 para validar y copia cifrada para la consulta autorizada del administrador.
const Auth = {
  KEY: 'cerveceria_users', VAULT: 'cerveceria_pin_key', failures: new Map(),
  users() { return JSON.parse(DataStore.getItem(this.KEY) || '[]'); },
  hex(bytes) { return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''); },
  bytes(hex) { return Uint8Array.from(hex.match(/../g) || [],h=>parseInt(h,16)); },
  randomPin() { let pin=''; while(pin.length<6) { const b=crypto.getRandomValues(new Uint8Array(1))[0]; if(b<250) pin+=String(b%10); } return pin; },
  validatePin(pin) { if(typeof pin !== 'string' || !/^[0-9]{4,8}$/.test(pin)) throw new Error('El NIP debe tener entre 4 y 8 dígitos.'); },
  async hash(secret,salt) {
    const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveBits']);
    return this.hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:this.bytes(salt),iterations:210000,hash:'SHA-256'},material,256)));
  },
  async seal(pin) {
    const keyHex=DataStore.getItem(this.VAULT) || this.hex(crypto.getRandomValues(new Uint8Array(32)));
    const key=await crypto.subtle.importKey('raw',this.bytes(keyHex),'AES-GCM',false,['encrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(pin));
    return {keyHex,cipher:{iv:this.hex(iv),data:this.hex(new Uint8Array(encrypted))}};
  },
  async readPin(id) {
    this.requireAdmin();
    const user=this.users().find(u=>u.id===id);
    if(!user || user.role!=='admin' || !user.pinCipher) throw new Error('Esta cuenta necesita configurar un NIP nuevo. El anterior no se puede recuperar.');
    const result=await this.decrypt(user);
    this.requireAdmin(); return result;
  },
  async decrypt(user) {
    const keyHex=DataStore.getItem(this.VAULT);
    if(!keyHex || !user.pinCipher) throw new Error('No hay copia consultable. Asigna un NIP nuevo.');
    try {
      const key=await crypto.subtle.importKey('raw',this.bytes(keyHex),'AES-GCM',false,['decrypt']);
      const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:this.bytes(user.pinCipher.iv)},key,this.bytes(user.pinCipher.data));
      return new TextDecoder().decode(clear);
    } catch { throw new Error('No se puede consultar este NIP. Asigna uno nuevo.'); }
  },
  async ensureCredentials() {
    if(this.users().length) return null;
    // Credencial inicial solicitada; se guarda una vez y nunca es una clave maestra.
    const pin='1234';
    const user=await this.addUser('Administrador',pin,'admin',true);
    console.info('[Seguridad] Administrador creado. NIP temporal: '+pin+'. Cámbialo en Ajustes → Gestión de Contraseñas.');
    return pin;
  },
  async addUser(name,pin,role,setup=false) {
    if(setup ? this.users().length>0 : !this.isAdmin()) throw new Error('No tienes permiso para crear usuarios.');
    if(role==='admin') { this.validatePin(pin); await this.ensureUniqueAdminPin(pin); } else this.validatePassword(pin);
    name=String(name).trim();
    if(name.length<2 || name.length>60 || !['admin','employee'].includes(role)) throw new Error('Nombre o rol inválido.');
    const salt=this.hex(crypto.getRandomValues(new Uint8Array(16)));
    const hash=await this.hash(pin,salt); const sealed=role==='admin'?await this.seal(pin):null;
    if(setup ? this.users().length>0 : !this.isAdmin()) throw new Error('La sesión cambió. Vuelve a entrar.');
    const users=this.users();
    if(users.some(u=>u.name.toLocaleLowerCase()===name.toLocaleLowerCase())) throw new Error('El usuario ya existe.');
    const user={id:crypto.randomUUID(),name,role,salt,hash,credentialType:role==='admin'?'pin':'password',...(sealed?{pinCipher:sealed.cipher}:{}),temporary:setup,active:true};
    DataStore.atomic(()=>{ if(sealed) DataStore.setItem(this.VAULT,sealed.keyHex); users.push(user); DataStore.setItem(this.KEY,JSON.stringify(users)); });
    return user;
  },
  async verify(name,secret,role) {
    const key=String(name).trim().toLocaleLowerCase(); const failure=this.failures.get(key);
    if(failure && failure.until>Date.now()) throw new Error('Espera un minuto antes de intentar nuevamente.');
    const user=this.users().find(u=>u.active && u.name.toLocaleLowerCase()===key && u.role===role);
    const hash=await this.hash(secret,user?user.salt:'0'.repeat(32));
    if(!user || hash!==user.hash || !this.users().some(u=>u.id===user.id && u.active && u.hash===hash)) {
      const count=(failure?failure.count:0)+1; this.failures.set(key,{count,until:count>=5?Date.now()+60000:0});
      throw new Error(role==='employee'?'Nombre o contraseña incorrectos.':'NIP incorrecto.');
    }
    this.failures.delete(key); const token=crypto.randomUUID();
    DataStore.setItem('cerveceria_auth',JSON.stringify({userId:user.id,token}));
    return {userId:user.id,authToken:token,role:user.role,name:user.name};
  },
  validSession(session) {
    const auth=JSON.parse(DataStore.getItem('cerveceria_auth') || 'null');
    return !!(session && auth && auth.token===session.authToken && auth.userId===session.userId && this.users().some(u=>u.active && u.id===session.userId && u.role===session.role && u.name===session.name));
  },
  isAdmin() { const s=typeof CashSession==='undefined'?null:CashSession.getActiveSession(); return !!s && s.role==='admin'; },
  requireAdmin() { if(!this.isAdmin()) throw new Error('Esta acción requiere una cuenta de administrador.'); },
  async setPin(id,pin,grant=null) {
    if(grant ? !this.validSession(grant) || grant.userId!==id || this.users().find(u=>u.id===id)?.credentialType==='pin' : !this.isAdmin()) throw new Error('No tienes permiso para cambiar este NIP.');
    if(this.users().find(u=>u.id===id)?.role!=='admin') throw new Error('Los empleados usan contraseña, no NIP.');
    this.validatePin(pin); await this.ensureUniqueAdminPin(pin,id);
    const salt=this.hex(crypto.getRandomValues(new Uint8Array(16))); const hash=await this.hash(pin,salt); const sealed=await this.seal(pin);
    if(grant ? !this.validSession(grant) : !this.isAdmin()) throw new Error('La sesión cambió. Vuelve a entrar.');
    const users=this.users(); const user=users.find(u=>u.id===id); if(!user) throw new Error('El usuario ya no existe.');
    Object.assign(user,{salt,hash,pinCipher:sealed.cipher,credentialType:'pin',temporary:false});
    DataStore.atomic(()=>{DataStore.setItem(this.VAULT,sealed.keyHex); DataStore.setItem(this.KEY,JSON.stringify(users));});
    this.failures.delete(user.name.toLocaleLowerCase());
  },
  validatePassword(secret) {
    if(typeof secret!=='string' || secret.length<8 || secret.length>128) throw new Error('Usa una contraseña de 8 a 128 caracteres.');
  },
  async ensureUniqueAdminPin(pin,exclude=null) {
    for(const user of this.users().filter(u=>u.role==='admin' && u.id!==exclude && u.credentialType==='pin')) {
      if(await this.hash(pin,user.salt)===user.hash) throw new Error('Otro administrador ya usa ese NIP. Elige uno diferente.');
    }
  },
  async verifyAdmin(pin) {
    const key='admin-keypad';const failure=this.failures.get(key);
    if(failure && failure.until>Date.now()) throw new Error('Espera un minuto antes de intentar nuevamente.');
    this.validatePin(pin);
    const matches=[];
    for(const user of this.users().filter(u=>u.active && u.role==='admin' && u.credentialType==='pin')) if(await this.hash(pin,user.salt)===user.hash) matches.push(user);
    if(matches.length!==1) {
      const count=(failure?failure.count:0)+1;this.failures.set(key,{count,until:count>=5?Date.now()+60000:0});
      throw new Error(matches.length>1?'Hay administradores con el mismo NIP. Usa la recuperación de cuentas para diferenciarlos.':'NIP incorrecto.');
    }
    const grant=await this.verify(matches[0].name,pin,'admin');this.failures.delete(key);return grant;
  },
  async setPassword(id,secret) {
    this.requireAdmin();this.validatePassword(secret);
    const salt=this.hex(crypto.getRandomValues(new Uint8Array(16)));const hash=await this.hash(secret,salt);
    this.requireAdmin();const users=this.users();const user=users.find(u=>u.id===id && u.role==='employee');
    if(!user) throw new Error('Selecciona una cuenta de empleado.');
    Object.assign(user,{salt,hash,credentialType:'password',temporary:false});delete user.pinCipher;
    DataStore.setItem(this.KEY,JSON.stringify(users));this.failures.delete(user.name.toLocaleLowerCase());
  },
  pinInput(name,label) { return '<label class="security-field">'+label+'<input class="login-field pin-input" name="'+name+'" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="off" required aria-label="'+label+'"></label>'; },
  passwordInput(name,label) { return '<label class="security-field">'+label+'<input class="login-field" name="'+name+'" type="password" minlength="8" maxlength="128" autocomplete="new-password" required aria-label="'+label+'"></label>'; },
  renderLogin(role='admin') {
    if(role==='admin') return this.renderAdminKeypad();
    const host=Login.container;
    host.innerHTML='<div class="login-screen"><h2 class="login-heading">Acceso Empleado</h2><form id="employee-login" class="login-form"><label class="security-field">Nombre de empleado<input class="login-field" name="username" autocomplete="username" maxlength="60" required aria-label="Nombre de empleado"></label><label class="security-field">Contraseña<input class="login-field" name="secret" type="password" autocomplete="current-password" maxlength="128" required aria-label="Contraseña"></label><p class="form-error" role="alert"></p><button class="login-submit">Entrar</button></form><button class="login-back" id="staff-back">Volver</button></div>';
    document.getElementById('staff-back').onclick=()=>Login.renderGlassyLogin();
    const form=document.getElementById('employee-login');form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;try{Login.openCash(await this.verify(form.elements.namedItem('username').value,form.elements.namedItem('secret').value,'employee'));}catch(error){form.querySelector('[role="alert"]').textContent=error.message;}finally{button.disabled=false;}};
  },
  renderAdminKeypad() {
    Login.container.innerHTML='<div class="login-screen admin-pin-screen"><h2 class="login-heading">NIP de Administrador</h2><output class="pin-display" id="admin-pin-display" aria-label="Dígitos del NIP ingresados">____</output><div class="pin-grid" id="admin-pin-grid">'+[1,2,3,4,5,6,7,8,9].map(n=>'<button class="pin-key" type="button" data-digit="'+n+'">'+n+'</button>').join('')+'<button class="pin-key is-clear" type="button" data-pin-clear aria-label="Borrar último dígito">⌫</button><button class="pin-key" type="button" data-digit="0">0</button><button class="pin-key is-ok" type="button" data-pin-submit>Entrar</button></div><p class="form-error" id="admin-pin-error" role="alert"></p><button class="login-back" id="admin-pin-back">Volver</button>'+ ((this.users().some(u=>u.active && u.role==='admin' && u.credentialType!=='pin') || this.users().filter(u=>u.active && u.role==='admin').length>1)?'<button class="login-back" id="admin-legacy">Migrar cuenta anterior</button>':'')+'</div>';
    let pin='',busy=false;const grid=document.getElementById('admin-pin-grid');const display=document.getElementById('admin-pin-display');const error=document.getElementById('admin-pin-error');
    const refresh=()=>{display.textContent='•'.repeat(pin.length).padEnd(Math.max(4,pin.length),'_');display.setAttribute('aria-label',pin.length+' dígitos ingresados');};
    const enter=async()=>{if(busy)return;busy=true;grid.querySelectorAll('button').forEach(b=>b.disabled=true);try{Login.openCash(await this.verifyAdmin(pin));}catch(e){error.textContent=e.message;pin='';refresh();}finally{busy=false;grid.querySelectorAll('button').forEach(b=>b.disabled=false);}};
    grid.addEventListener('click',event=>{const button=event.target.closest('button');if(!button || busy)return;if(button.hasAttribute('data-digit') && pin.length<8){pin+=button.dataset.digit;error.textContent='';refresh();}else if(button.hasAttribute('data-pin-clear')){pin=pin.slice(0,-1);refresh();}else if(button.hasAttribute('data-pin-submit'))enter();});
    document.getElementById('admin-pin-back').onclick=()=>Login.renderGlassyLogin();
    const legacy=document.getElementById('admin-legacy');if(legacy)legacy.onclick=()=>this.renderLegacyAdminLogin();
  },
  renderLegacyAdminLogin() {
    Login.container.innerHTML='<div class="login-screen"><h2 class="login-heading">Recuperar cuenta anterior</h2><form id="legacy-login" class="login-form"><input class="login-field" name="username" aria-label="Nombre anterior" placeholder="Nombre anterior" required><input class="login-field" name="secret" type="password" aria-label="Contraseña anterior" placeholder="Contraseña anterior" required><p class="form-error" role="alert"></p><button class="login-submit">Configurar NIP</button></form><button id="legacy-back" class="login-back">Volver</button></div>';
    document.getElementById('legacy-back').onclick=()=>this.renderAdminKeypad();const form=document.getElementById('legacy-login');form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{const grant=await this.verify(form.elements.namedItem('username').value,form.elements.namedItem('secret').value,'admin');if(this.users().find(u=>u.id===grant.userId).credentialType==='pin')Login.openCash(grant);else this.renderMigration(grant);}catch(error){form.querySelector('[role="alert"]').textContent=error.message;}finally{b.disabled=false;}};
  },
  renderMigration(grant) {
    Login.container.innerHTML='<div class="login-screen"><h2 class="login-heading">Configura tu NIP</h2><p class="login-note">Tu inventario e historial se conservan.</p><form class="login-form" id="pin-migrate">'+this.pinInput('pin','Nuevo NIP')+this.pinInput('repeat','Repetir NIP')+'<p class="form-error" role="alert"></p><button class="login-submit">Guardar NIP y continuar</button></form></div>';
    const form=document.getElementById('pin-migrate'); form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{if(form.elements.namedItem('pin').value!==form.elements.namedItem('repeat').value)throw new Error('Los NIP no coinciden.');await this.setPin(grant.userId,form.elements.namedItem('pin').value,grant);Login.openCash(grant);}catch(error){form.querySelector('[role="alert"]').textContent=error.message;}finally{button.disabled=false;}};
  },
  async renderBootstrapNotice() {
    const user=this.users().find(u=>u.temporary && u.role==='admin'); if(!user) return;
    const host=Login.container;
    const notice=document.createElement('p'); notice.className='bootstrap-pin login-note';
    notice.textContent='NIP inicial de administrador: '+await this.decrypt(user)+'. Cámbialo en Ajustes → Gestión de Contraseñas.';
    if(host===Login.container && host.querySelector('.login-roles')) host.querySelector('.auth-panel').appendChild(notice);
  },
  renderUsers() {
    this.requireAdmin();const overlay=document.createElement('div');overlay.className='security-overlay';
    overlay.innerHTML='<section class="security-card" role="dialog" aria-modal="true" aria-labelledby="users-heading"><h2 id="users-heading">Gestión de Contraseñas</h2><p>Administrador: NIP táctil. Empleados: nombre y contraseña.</p><div id="users-list"></div><h3>Crear acceso</h3><form id="user-create" class="login-form"><label class="security-field">Nombre<input class="login-field" name="username" aria-label="Nombre de usuario" required maxlength="60"></label><label class="security-field">Rol<select class="login-field" name="role" aria-label="Rol"><option value="employee">Empleado</option><option value="admin">Administrador</option></select></label><div id="create-secret"></div><p role="status" id="users-error"></p><button class="btn" type="submit">Crear usuario</button></form><button class="btn secondary" id="users-close">Cerrar</button></section>';
    document.body.appendChild(overlay);
    const refresh=()=>{const list=overlay.querySelector('#users-list');list.replaceChildren();this.users().forEach(user=>{
      const admin=user.role==='admin';const row=document.createElement('section');row.className='security-user';const title=document.createElement('h3');title.textContent=user.name+' · '+(admin?'Administrador':'Empleado')+(user.active?'':' · Inactivo');row.appendChild(title);
      const status=document.createElement('p');status.className='security-pin-status';status.setAttribute('role','status');status.textContent=admin?(user.temporary?'NIP inicial: cámbialo en este panel.':'Acceso por NIP'):(user.credentialType==='password'?'Acceso con nombre y contraseña':'Acceso anterior vigente; puedes asignar una contraseña nueva.');row.appendChild(status);
      if(admin){let visible=false;const reveal=document.createElement('button');reveal.className='btn secondary';reveal.textContent='Ver NIP';reveal.onclick=async()=>{reveal.disabled=true;try{status.textContent=visible?'NIP oculto':await this.readPin(user.id);visible=!visible;reveal.textContent=visible?'Ocultar NIP':'Ver NIP';}catch(error){status.textContent=error.message;}finally{reveal.disabled=false;}};row.appendChild(reveal);}
      const form=document.createElement('form');form.className='login-form';const label=admin?'Nuevo NIP':'Nueva contraseña';form.innerHTML=(admin?this.pinInput('secret',label):this.passwordInput('secret',label))+(admin?this.pinInput('repeat','Repetir NIP'):this.passwordInput('repeat','Repetir contraseña'))+'<button class="btn" type="submit">'+(admin?'Guardar NIP':'Guardar contraseña')+'</button>';
      form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const secret=form.elements.namedItem('secret').value;if(secret!==form.elements.namedItem('repeat').value)throw new Error('Los valores no coinciden.');if(admin)await this.setPin(user.id,secret);else await this.setPassword(user.id,secret);form.reset();status.textContent=admin?'NIP actualizado.':'Contraseña actualizada.';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}};row.appendChild(form);
      if(user.id!==CashSession.getActiveSession().userId){const toggle=document.createElement('button');toggle.className='btn secondary';toggle.textContent=user.active?'Desactivar':'Activar';toggle.onclick=()=>{this.requireAdmin();const users=this.users();users.find(u=>u.id===user.id).active=!user.active;DataStore.setItem(this.KEY,JSON.stringify(users));refresh();};row.appendChild(toggle);}list.appendChild(row);
    });};refresh();
    const form=overlay.querySelector('#user-create');const role=form.elements.namedItem('role');const fields=()=>{overlay.querySelector('#create-secret').innerHTML=role.value==='admin'?this.pinInput('secret','NIP del administrador')+this.pinInput('repeat','Repetir NIP'):this.passwordInput('secret','Contraseña del empleado')+this.passwordInput('repeat','Repetir contraseña');};fields();role.onchange=fields;
    overlay.querySelector('#users-close').onclick=()=>overlay.remove();form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const secret=form.elements.namedItem('secret').value;if(secret!==form.elements.namedItem('repeat').value)throw new Error('Los valores no coinciden.');await this.addUser(form.elements.namedItem('username').value,secret,role.value);form.reset();fields();refresh();overlay.querySelector('#users-error').textContent='Acceso creado.';}catch(error){overlay.querySelector('#users-error').textContent=error.message;}finally{button.disabled=false;}};
  },
  escape(value) {return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
};
