-- Fixtures transaccionales: no modifica datos de negocios existentes ni envía correos.
begin;
select set_config('test.business',gen_random_uuid()::text,true),set_config('test.other',gen_random_uuid()::text,true),set_config('test.owner',gen_random_uuid()::text,true),set_config('test.employee',gen_random_uuid()::text,true),set_config('test.device',gen_random_uuid()::text,true),set_config('test.installation',gen_random_uuid()::text,true);
insert into public.pos_businesses(id,name) values(current_setting('test.business')::uuid,'Test isolated history'),(current_setting('test.other')::uuid,'Other business');
insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values(current_setting('test.owner')::uuid,gen_random_uuid()||'@example.invalid',now(),'{}'),(current_setting('test.employee')::uuid,gen_random_uuid()||'@example.invalid',now(),'{}'),(current_setting('test.device')::uuid,gen_random_uuid()||'@example.invalid',now(),'{"kind":"pos_terminal"}');
insert into public.pos_members values(current_setting('test.business')::uuid,current_setting('test.owner')::uuid,'Owner','admin',true),(current_setting('test.business')::uuid,current_setting('test.employee')::uuid,'Employee','employee',true);
insert into public.pos_products(business_id,id,data,stock) values(current_setting('test.business')::uuid,'p1','{"nombre":"Test","precioVenta":50,"costoPieza":26,"precioCarton":470,"costoCarton":320,"promocionesVolumen":[{"cantidad":2,"precio":90}]}',100);
insert into public.pos_terminal_shifts values(current_setting('test.business')::uuid,current_setting('test.installation')::uuid,'old-shift','Owner',0,'2020-02-01','2020-02-02',0);
insert into public.pos_terminal_sales values(current_setting('test.business')::uuid,current_setting('test.installation')::uuid,'old-sale','old-shift','owner','Owner','admin',5000,'{"cash_cents":5000}','2020-02-01','completed');
insert into public.pos_terminal_items values(current_setting('test.business')::uuid,current_setting('test.installation')::uuid,'old-sale',1,'p1',1,false,'{"nombre":"Test"}',5000,2600);
select pos_private.register_terminal(current_setting('test.business')::uuid,current_setting('test.installation')::uuid,current_setting('test.device')::uuid,current_setting('test.owner')::uuid,'Test');
set local role authenticated;
do $$ declare b uuid:=current_setting('test.business')::uuid; archive jsonb; result jsonb; denied boolean:=false; begin
 perform set_config('request.jwt.claim.sub',current_setting('test.employee'),true);
 if exists(select 1 from public.pos_products where business_id=b) then raise exception 'FAIL costos accesibles directamente'; end if;
 result:=public.pos_snapshot(b);
 if result->'products'->0->'data' ? 'costoPieza' or result->'products'->0->'data'->'promocionesVolumen' is null then raise exception 'FAIL catálogo de venta seguro'; end if;
 begin perform public.pos_history_archive(b); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL empleado exporta historial'; end if;
 if public.pos_snapshot(current_setting('test.other')::uuid) is not null then raise exception 'FAIL aislamiento negocios'; end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
 archive:=public.pos_history_archive(b);
 if (archive->>'year')::integer<>2020 or jsonb_array_length(archive->'data'->'terminal_sales')<>1 then raise exception 'FAIL selección del año más antiguo'; end if;
 denied:=false;begin perform public.pos_prune_history(b,2020,'incorrecto','ELIMINAR 2020'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'FAIL respaldo alterado'; end if;
 result:=public.pos_prune_history(b,2020,archive->>'fingerprint','ELIMINAR 2020');
 if exists(select 1 from public.pos_terminal_sales where business_id=b) or (select stock from public.pos_products where business_id=b and id='p1')<>100 then raise exception 'FAIL limpieza alteró stock o conservó venta'; end if;
 perform set_config('request.jwt.claim.sub',current_setting('test.device'),true);
 result:=public.pos_terminal_sync(b,gen_random_uuid(),jsonb_build_object('installation',current_setting('test.installation'),'expected','{"p1":1}'::jsonb,'products',jsonb_build_array(jsonb_build_object('id','p1','stock',100,'cold_stock',0,'data','{"nombre":"Test","precioVenta":50,"costoPieza":26,"precioCarton":470,"costoCarton":320,"promocionesVolumen":[{"cantidad":2,"precio":90}]}'::jsonb)),
 'cycles','[]'::jsonb,'shifts',jsonb_build_array(jsonb_build_object('id','old-shift','opened_at','2020-02-01','closed_at','2020-02-02')),'sales',jsonb_build_array(jsonb_build_object('id','old-sale','created_at','2020-02-01'))));
 perform set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
 if exists(select 1 from public.pos_terminal_sales where business_id=b) or exists(select 1 from public.pos_terminal_shifts where business_id=b) then raise exception 'FAIL dispositivo resucitó historial eliminado'; end if;
end $$;
reset role;
select 'PASS: empleado sin costos, promociones disponibles, aislamiento, respaldo validado, borrado anual sin alterar stock y protección contra reenvío antiguo' as verification;
rollback;
