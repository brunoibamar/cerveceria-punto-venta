-- Prueba real en PostgreSQL. Todos los datos de esta prueba se revierten.
begin;
select set_config('pos.test_business',gen_random_uuid()::text,true);
select set_config('pos.test_admin',gen_random_uuid()::text,true);
select set_config('pos.test_employee',gen_random_uuid()::text,true);
insert into public.pos_businesses(id,name) values(current_setting('pos.test_business')::uuid,'TEST ROLLBACK');
insert into auth.users(id,email,email_confirmed_at) values
  (current_setting('pos.test_admin')::uuid,gen_random_uuid()::text||'@example.invalid',now()),
  (current_setting('pos.test_employee')::uuid,gen_random_uuid()::text||'@example.invalid',now());
insert into public.pos_members(business_id,user_id,display_name,role) values
  (current_setting('pos.test_business')::uuid,current_setting('pos.test_admin')::uuid,'Test Admin','admin'),
  (current_setting('pos.test_business')::uuid,current_setting('pos.test_employee')::uuid,'Test Employee','employee');
set local role authenticated;
do $$
declare
  b uuid:=current_setting('pos.test_business')::uuid;
  employee uuid:=current_setting('pos.test_employee')::uuid;
  shift_id uuid;
  request_id uuid:=gen_random_uuid();
  payload jsonb;
  result jsonb;
  replay jsonb;
  denied boolean;
  stock integer;
begin
  perform set_config('request.jwt.claim.sub',current_setting('pos.test_admin'),true);
  perform public.pos_command(b,gen_random_uuid(),'save_product',jsonb_build_object(
    'id','test-product','stock',30,'cold_stock',5,'data',jsonb_build_object('nombre','Test','precioVenta',50,'costoPieza',26,'unidadesPorCarton',12,'precioCarton',470,'costoCarton',320,'cobroExtraEnvaseFaltantePieza',10,'cobroExtraEnvaseFaltanteCarton',10)));
  perform set_config('request.jwt.claim.sub',employee::text,true);
  if (select count(*) from public.pos_businesses)<>1 then raise exception 'FAIL aislamiento de negocio'; end if;
  denied:=false;
  begin
    perform public.pos_command(b,gen_random_uuid(),'save_settings','{"data":{"coldCharge":1}}');
  exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL permisos de empleado'; end if;
  denied:=false;
  begin update public.pos_products set stock=999 where business_id=b;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'FAIL escritura directa'; end if;
  result:=public.pos_command(b,gen_random_uuid(),'open_shift','{"opening_cents":10000}');
  shift_id:=(result->>'id')::uuid;
  payload:=jsonb_build_object('shift_id',shift_id,'expected_total_cents',47000,'payment',jsonb_build_object('cash_cents',47000),
    'items',jsonb_build_array(jsonb_build_object('product_id','test-product','revision',1,'quantity',12,'cold',false)));
  result:=public.pos_command(b,request_id,'sale',payload);
  replay:=public.pos_command(b,request_id,'sale',payload);
  if result<>replay then raise exception 'FAIL reintento idempotente'; end if;
  select p.stock into stock from public.pos_products p where business_id=b and id='test-product';
  if stock<>18 or (select count(*) from public.pos_sales where business_id=b)<>1 then raise exception 'FAIL stock o venta duplicada'; end if;
  if (select cashier_name from public.pos_sales where business_id=b)<>'Test Employee' then raise exception 'FAIL responsable'; end if;
  denied:=false;
  begin perform public.pos_command(b,gen_random_uuid(),'sale',payload);
  exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL revision desactualizada'; end if;
  payload:=jsonb_set(payload,'{items,0,revision}','2');
  payload:=jsonb_set(payload,'{items,0,quantity}','100');
  denied:=false;
  begin perform public.pos_command(b,gen_random_uuid(),'sale',payload);
  exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'FAIL sobreventa'; end if;
  if (select p.stock from public.pos_products p where business_id=b and id='test-product')<>18 then raise exception 'FAIL reversión de inventario'; end if;
  result:=public.pos_command(b,gen_random_uuid(),'close_shift',jsonb_build_object('id',shift_id,'counted_cents',57000));
  if (result->>'difference_cents')::bigint<>0 then raise exception 'FAIL corte de caja'; end if;
  if public.pos_snapshot(b)->'member'->>'role'<>'employee' then raise exception 'FAIL snapshot autenticado'; end if;
end $$;
reset role;
select 'PASS: permisos, aislamiento, venta/cartón, responsable, idempotencia, stock, revisión, reversión y corte' as verification;
rollback;
