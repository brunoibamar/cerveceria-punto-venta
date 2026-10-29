-- Todos los usuarios y datos de esta prueba se revierten. No se envían correos.
begin;
select set_config('pos.test_business',gen_random_uuid()::text,true);
select set_config('pos.test_owner',gen_random_uuid()::text,true);
select set_config('pos.test_device',gen_random_uuid()::text,true);
select set_config('pos.test_installation',gen_random_uuid()::text,true);
insert into public.pos_businesses(id,name) values(current_setting('pos.test_business')::uuid,'Terminal TEST ROLLBACK');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values
 (current_setting('pos.test_owner')::uuid,gen_random_uuid()::text||'@example.invalid',now(),'{}'),
 (current_setting('pos.test_device')::uuid,gen_random_uuid()::text||'@example.invalid',now(),'{"kind":"pos_terminal"}');
insert into public.pos_members values(current_setting('pos.test_business')::uuid,current_setting('pos.test_owner')::uuid,'Owner','admin',true);
select pos_private.register_terminal(current_setting('pos.test_business')::uuid,current_setting('pos.test_installation')::uuid,current_setting('pos.test_device')::uuid,current_setting('pos.test_owner')::uuid,'Test terminal');
set local role authenticated;
do $$
declare b uuid:=current_setting('pos.test_business')::uuid; request uuid:=gen_random_uuid();
  payload jsonb; result jsonb; replay jsonb; denied boolean; sale jsonb; current_stock integer;
begin
  perform set_config('request.jwt.claim.sub',current_setting('pos.test_device'),true);
  if public.pos_has_access(b) or public.pos_snapshot(b) is not null then raise exception 'FAIL terminal puede leer supervisor'; end if;
  denied:=false;
  begin perform public.pos_report(b,current_date,current_date); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL terminal puede leer reportes'; end if;
  denied:=false;
  begin perform public.pos_register_terminal(b,gen_random_uuid(),current_setting('pos.test_device')::uuid,current_setting('pos.test_owner')::uuid,'no autorizado'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL terminal puede crear accesos'; end if;
  denied:=false;
  begin insert into public.pos_products values(b,'forged','{}',100,0,1,now()); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL escritura directa'; end if;
  payload:=jsonb_build_object('installation',current_setting('pos.test_installation'),'expected','{}'::jsonb,'cycles','[]'::jsonb,
    'products',jsonb_build_array(
      jsonb_build_object('id','corona','stock',1788,'cold_stock',0,'data',jsonb_build_object('nombre','Corona','precioVenta',50,'precioCarton',470,'costoPieza',26,'costoCarton',320)),
      jsonb_build_object('id','tecate','stock',3576,'cold_stock',0,'data',jsonb_build_object('nombre','Tecate','precioVenta',28,'precioCarton',470,'costoPieza',15,'costoCarton',320))),
    'shifts',jsonb_build_array(jsonb_build_object('id','shift-1','cashier_name','Admin local','opening_cents',0,'opened_at',now(),'closed_at',now(),'counted_cents',0)),
    'sales',jsonb_build_array(jsonb_build_object('id','sale-card','shift_id','shift-1','cashier_id','local-admin','cashier_name','Admin local','cashier_role','admin','total_cents',94000,'payment',jsonb_build_object('card_cents',94000),'created_at',now(),'status','completed',
      'items',jsonb_build_array(jsonb_build_object('product_id','corona','quantity',12,'cold',false,'snapshot',jsonb_build_object('nombre','Corona','container_cents',0),'total_cents',47000,'cost_cents',32000),jsonb_build_object('product_id','tecate','quantity',24,'cold',false,'snapshot',jsonb_build_object('nombre','Tecate','container_cents',0),'total_cents',47000,'cost_cents',32000)))));
  result:=public.pos_terminal_sync(b,request,payload);
  replay:=public.pos_terminal_sync(b,request,payload);
  if result<>replay then raise exception 'FAIL reintento perdió idempotencia'; end if;
  -- Ni la lectura general ni los reportes se habilitan al terminar el envío.
  if public.pos_has_access(b) then raise exception 'FAIL el envío amplió permisos'; end if;
  denied:=false;
  begin perform public.pos_terminal_sync(gen_random_uuid(),gen_random_uuid(),payload); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL aislamiento de negocio'; end if;
  payload:=jsonb_set(payload,'{expected}',result->'revisions');
  payload:=jsonb_set(payload,'{products,0,stock}','1787');
  payload:=jsonb_set(payload,'{products,1,stock}','3575');
  sale:=jsonb_build_object('id','sale-cash','shift_id','shift-2','cashier_id','local-employee','cashier_name','Empleado local','cashier_role','employee','total_cents',2800,'payment',jsonb_build_object('cash_cents',2800),'created_at',now(),'status','completed',
    'items',jsonb_build_array(jsonb_build_object('product_id','tecate','quantity',1,'cold',false,'snapshot',jsonb_build_object('nombre','Tecate','container_cents',0),'total_cents',2800,'cost_cents',1500)));
  payload:=jsonb_set(payload,'{sales}',jsonb_build_array(sale,sale||jsonb_build_object('id','sale-transfer','total_cents',5000,'payment',jsonb_build_object('transfer_cents',5000),'items',jsonb_build_array(jsonb_build_object('product_id','corona','quantity',1,'cold',false,'snapshot',jsonb_build_object('nombre','Corona','container_cents',0),'total_cents',5000,'cost_cents',2600)))));
  result:=public.pos_terminal_sync(b,gen_random_uuid(),payload);
  payload:=jsonb_set(payload,'{expected}',result->'revisions');
  perform set_config('request.jwt.claim.sub',current_setting('pos.test_owner'),true);
  select stock into current_stock from public.pos_products where business_id=b and id='corona';
  if current_stock<>1787 then raise exception 'FAIL doble descuento de inventario'; end if;
  result:=public.pos_report(b,(now() at time zone 'America/Mexico_City')::date,(now() at time zone 'America/Mexico_City')::date);
  if (result->'totals'->>'tickets')::integer<>3 or (result->'costs'->>'units')::integer<>38 or (result->'totals'->>'total_cents')::bigint<>101800
     or jsonb_array_length(result->'employees')<>2 or (result->'totals'->>'card_cents')::bigint<>94000
     or (result->'totals'->>'cash_cents')::bigint<>2800 or (result->'totals'->>'transfer_cents')::bigint<>5000 then raise exception 'FAIL reportes por cajero y método de pago'; end if;
  if (public.pos_snapshot(b)->'shifts'->0->>'closed_at') is null then raise exception 'FAIL cierre de turno no reflejado'; end if;
  -- La caja compartida sigue operativa. Un cambio allí provoca conflicto, nunca sobreescritura.
  result:=public.pos_command(b,gen_random_uuid(),'open_shift','{"opening_cents":0}'::jsonb);
  result:=public.pos_command(b,gen_random_uuid(),'sale',jsonb_build_object('shift_id',result->>'id','expected_total_cents',5000,'payment',jsonb_build_object('cash_cents',5000),
    'items',jsonb_build_array(jsonb_build_object('product_id','corona','revision',(select revision from public.pos_products where business_id=b and id='corona'),'quantity',1,'cold',false))));
  result:=public.pos_report(b,(now() at time zone 'America/Mexico_City')::date,(now() at time zone 'America/Mexico_City')::date);
  if (result->'totals'->>'tickets')::integer<>4 or (result->'costs'->>'units')::integer<>39 then raise exception 'FAIL integración de ventas nativas y de terminal'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('pos.test_device'),true);
  denied:=false;
  begin perform public.pos_terminal_sync(b,gen_random_uuid(),payload); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL no detectó cambio de otra caja'; end if;
  perform set_config('request.jwt.claim.sub',current_setting('pos.test_owner'),true);
  if (select stock from public.pos_products where business_id=b and id='corona')<>1786 then raise exception 'FAIL sobreescribió otra caja'; end if;
  perform public.pos_terminal_link(b,true);
  perform set_config('request.jwt.claim.sub',current_setting('pos.test_device'),true);
  denied:=false;
  begin perform public.pos_terminal_sync(b,gen_random_uuid(),payload); exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL revocación de terminal'; end if;
end $$;
reset role;
select 'PASS: tarjeta/efectivo/transferencia, cajeros admin/empleado, 38 piezas, saldo sin doble descuento, cierre, reintentos, aislamiento y revocación' as verification;
rollback;
