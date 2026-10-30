import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const allowed = new Set(['https://brunoibamar.github.io','http://localhost:4174','http://127.0.0.1:4174','http://localhost:4173']);
Deno.serve(async req => {
  const origin=req.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':origin&&allowed.has(origin)?origin:'https://brunoibamar.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
  const reply=(status:number,message:unknown)=>new Response(JSON.stringify(message),{status,headers});
  if(origin&&!allowed.has(origin))return reply(403,{error:'Origen no autorizado'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Método no permitido'});
  const authorization=req.headers.get('authorization');
  if(!authorization?.startsWith('Bearer '))return reply(401,{error:'Inicia sesión como administrador'});
  const url=Deno.env.get('SUPABASE_URL')!;
  const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!;
  const owner=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const identity=await owner.auth.getUser(authorization.slice(7));
  if(identity.error||!identity.data.user)return reply(401,{error:'Sesión no válida'});
  let body;
  try{body=await req.json();}catch{return reply(400,{error:'Datos inválidos'});}
  if(body.authorize_terminal!==true||!/^[0-9a-f-]{36}$/i.test(body.installation||'')||!/^[0-9a-f-]{36}$/i.test(body.business_id||''))return reply(400,{error:'Confirma la autorización de la terminal'});
  const access=await owner.rpc('pos_has_access',{p_business:body.business_id,p_admin:true});
  if(access.error||access.data!==true)return reply(403,{error:'Requiere administrador del negocio'});
  // Solo el servidor conoce la clave de servicio. La cuenta técnica no pertenece a pos_members.
  const service=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  // bcrypt acepta hasta 72 bytes: 5 de prefijo + 64 hexadecimales = 69 ASCII.
  const password='T!a9-'+(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-','');
  const email='terminal-'+crypto.randomUUID()+'@pos.example.invalid';
  const account=await service.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{kind:'pos_terminal'}});
  if(account.error||!account.data.user)return reply(500,{error:'No se pudo preparar la identidad de terminal'});
  const bind=await service.rpc('pos_register_terminal',{p_business:body.business_id,p_installation:body.installation,p_user:account.data.user.id,p_owner:identity.data.user.id,p_label:'Terminal de ventas vinculada'});
  if(bind.error)return reply(409,{error:bind.error.message});
  const terminal=createClient(url,anonKey,{auth:{persistSession:false}});
  const login=await terminal.auth.signInWithPassword({email,password});
  if(login.error||!login.data.session)return reply(500,{error:'No se pudo iniciar la sesión de terminal'});
  return reply(200,{access_token:login.data.session.access_token,refresh_token:login.data.session.refresh_token});
});
