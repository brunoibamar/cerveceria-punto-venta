create table pos_private.inventory_links (
  business_id uuid primary key references public.pos_businesses(id),
  installation uuid not null,
  linked_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
create index inventory_links_user_idx on pos_private.inventory_links(linked_by);
alter table pos_private.inventory_links enable row level security;
revoke all on pos_private.inventory_links from public,anon,authenticated;
create policy no_client_access on pos_private.inventory_links to authenticated using(false) with check(false);

create function pos_private.sync_inventory(p_business uuid,p_request uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous pos_private.pos_requests; link pos_private.inventory_links; item jsonb; product public.pos_products;
  revisions jsonb; result jsonb; installation uuid; member_id uuid;
begin
  if auth.uid() is null or not public.pos_has_access(p_business,true) then raise exception 'La vinculación requiere administrador'; end if;
  perform id from public.pos_businesses where id=p_business for update;
  select * into previous from pos_private.pos_requests where business_id=p_business and id=p_request;
  if found then
    if previous.user_id<>auth.uid() or previous.command<>'inventory_sync' or previous.payload<>p_payload then raise exception 'Identificador de operación ya utilizado'; end if;
    return previous.result;
  end if;
  installation:=(p_payload->>'installation')::uuid;
  if installation is null then raise exception 'Dispositivo inválido'; end if;
  if jsonb_typeof(p_payload->'products') is distinct from 'array' then raise exception 'Catálogo inválido'; end if;
  if jsonb_array_length(p_payload->'products')>5000 then raise exception 'Catálogo demasiado grande'; end if;
  if (select count(*) from jsonb_array_elements(p_payload->'products'))<>(select count(distinct value->>'id') from jsonb_array_elements(p_payload->'products')) then raise exception 'Productos duplicados'; end if;
  select * into link from pos_private.inventory_links where business_id=p_business;
  if found and link.installation<>installation then raise exception 'Otro dispositivo ya está vinculado. No se reemplazó su inventario'; end if;
  select coalesce(jsonb_object_agg(id,revision),'{}'::jsonb) into revisions from public.pos_products where business_id=p_business;
  if revisions is distinct from p_payload->'expected' then raise exception 'El inventario de nube cambió. Revisa el conflicto antes de volver a vincular'; end if;
  for item in select value from jsonb_array_elements(p_payload->'products') loop
    select * into product from public.pos_products where business_id=p_business and id=item->>'id';
    if not found or product.data is distinct from item->'data' or product.stock is distinct from (item->>'stock')::integer or product.cold_stock is distinct from (item->>'cold_stock')::integer then
      perform pos_private.command(p_business,gen_random_uuid(),'save_product',item||jsonb_build_object('revision',product.revision));
    end if;
  end loop;
  for product in select * from public.pos_products p where p.business_id=p_business and not exists(select 1 from jsonb_array_elements(p_payload->'products') x where x->>'id'=p.id) and (coalesce((p.data->>'activo')::boolean,true) or p.stock<>0) loop
    perform pos_private.command(p_business,gen_random_uuid(),'save_product',jsonb_build_object('id',product.id,'revision',product.revision,'stock',0,'cold_stock',0,'data',product.data||'{"activo":false}'::jsonb));
  end loop;
  if jsonb_typeof(p_payload->'cycles') is distinct from 'array' then raise exception 'Ciclos inválidos'; end if;
  insert into public.pos_documents(business_id,kind,data) values(p_business,'inventory_cycles',p_payload->'cycles')
    on conflict(business_id,kind) do update set data=excluded.data,revision=public.pos_documents.revision+1;
  insert into pos_private.inventory_links(business_id,installation,linked_by) values(p_business,installation,auth.uid())
    on conflict(business_id) do update set updated_at=now();
  select coalesce(jsonb_object_agg(id,revision),'{}'::jsonb) into revisions from public.pos_products where business_id=p_business;
  result:=jsonb_build_object('revisions',revisions,'synced_at',now());
  insert into pos_private.pos_requests(business_id,id,user_id,command,payload,result) values(p_business,p_request,auth.uid(),'inventory_sync',p_payload,result);
  return result;
end $$;
revoke all on function pos_private.sync_inventory(uuid,uuid,jsonb) from public,anon;
grant execute on function pos_private.sync_inventory(uuid,uuid,jsonb) to authenticated;
create function public.pos_sync_inventory(p_business uuid,p_request uuid,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select pos_private.sync_inventory(p_business,p_request,p_payload); $$;
revoke all on function public.pos_sync_inventory(uuid,uuid,jsonb) from public,anon;
grant execute on function public.pos_sync_inventory(uuid,uuid,jsonb) to authenticated;
