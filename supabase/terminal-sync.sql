-- Identidad de terminal autenticada: no es administrador ni miembro lector del negocio.
create table pos_private.terminals (
  business_id uuid primary key references public.pos_businesses(id),
  installation uuid not null unique,
  auth_user_id uuid not null unique references auth.users(id),
  authorized_by uuid not null references auth.users(id),
  label text not null,
  active boolean not null default true,
  last_sync_at timestamptz,
  enrolled_at timestamptz not null default now()
);
create index terminals_owner_idx on pos_private.terminals(authorized_by);
alter table pos_private.terminals enable row level security;
revoke all on pos_private.terminals from public,anon,authenticated;
create policy no_client_access on pos_private.terminals to authenticated using(false) with check(false);

create table public.pos_terminal_sales (
  business_id uuid not null references public.pos_businesses(id),installation uuid not null,
  id text not null,shift_id text not null,cashier_id text not null,cashier_name text not null,cashier_role text not null,
  total_cents bigint not null check(total_cents>=0),payment jsonb not null,
  created_at timestamptz not null,status text not null check(status in ('completed','cancelled')),
  primary key(business_id,installation,id)
);
create index terminal_sales_period_idx on public.pos_terminal_sales(business_id,created_at desc);
create table public.pos_terminal_items (
  business_id uuid not null,installation uuid not null,sale_id text not null,line integer not null,
  product_id text not null,quantity integer not null check(quantity>0),cold boolean not null,
  snapshot jsonb not null,total_cents bigint not null check(total_cents>=0),cost_cents bigint check(cost_cents>=0),
  primary key(business_id,installation,sale_id,line),
  foreign key(business_id,installation,sale_id) references public.pos_terminal_sales(business_id,installation,id),
  foreign key(business_id,product_id) references public.pos_products(business_id,id)
);
create index terminal_items_product_idx on public.pos_terminal_items(business_id,product_id);
create table public.pos_terminal_shifts (
  business_id uuid not null references public.pos_businesses(id),installation uuid not null,
  id text not null,cashier_name text not null,opening_cents bigint not null check(opening_cents>=0),
  opened_at timestamptz not null,closed_at timestamptz,counted_cents bigint check(counted_cents>=0),
  primary key(business_id,installation,id)
);
do $$ declare t text; begin
  foreach t in array array['pos_terminal_sales','pos_terminal_items','pos_terminal_shifts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy business_read on public.%I for select to authenticated using(public.pos_has_access(business_id))',t);
    execute format('alter publication supabase_realtime add table public.%I',t);
  end loop;
end $$;

create function pos_private.register_terminal(p_business uuid,p_installation uuid,p_user uuid,p_owner uuid,p_label text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.pos_members where business_id=p_business and user_id=p_owner and active and role='admin') then raise exception 'Requiere administrador'; end if;
  if not exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'kind'='pos_terminal') then raise exception 'Identidad de terminal inválida'; end if;
  if exists(select 1 from public.pos_members where user_id=p_user) then raise exception 'La terminal no puede tener permisos de usuario'; end if;
  perform id from public.pos_businesses where id=p_business for update;
  if exists(select 1 from pos_private.inventory_links where business_id=p_business and installation<>p_installation) then raise exception 'El inventario ya está vinculado a otra instalación'; end if;
  insert into pos_private.terminals(business_id,installation,auth_user_id,authorized_by,label)
    values(p_business,p_installation,p_user,p_owner,left(p_label,100))
    on conflict(business_id) do update set auth_user_id=excluded.auth_user_id,authorized_by=excluded.authorized_by,label=excluded.label,active=true,enrolled_at=now()
    where pos_private.terminals.installation=excluded.installation;
  if not found then raise exception 'Otra terminal ya está vinculada'; end if;
end $$;
revoke all on function pos_private.register_terminal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant usage on schema pos_private to service_role;
grant execute on function pos_private.register_terminal(uuid,uuid,uuid,uuid,text) to service_role;
create function public.pos_register_terminal(p_business uuid,p_installation uuid,p_user uuid,p_owner uuid,p_label text)
returns void language sql security invoker set search_path='' as $$ select pos_private.register_terminal(p_business,p_installation,p_user,p_owner,p_label); $$;
revoke all on function public.pos_register_terminal(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pos_register_terminal(uuid,uuid,uuid,uuid,text) to service_role;

create function pos_private.terminal_sync(p_business uuid,p_request uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare device pos_private.terminals; previous pos_private.pos_requests; product public.pos_products;
  entry jsonb; sale jsonb; item jsonb; revisions jsonb; result jsonb; old public.pos_terminal_sales;
  qty integer; cold_qty integer; v_price numeric; n integer; line_sum bigint; total bigint;
begin
  if auth.uid() is null then raise exception 'Inicia la sesión de terminal'; end if;
  select * into device from pos_private.terminals where business_id=p_business and auth_user_id=auth.uid() and active;
  if not found or device.installation::text is distinct from p_payload->>'installation' then raise exception 'Terminal no autorizada'; end if;
  if not exists(select 1 from public.pos_members where business_id=p_business and user_id=device.authorized_by and active and role='admin') then raise exception 'Autorización revocada'; end if;
  perform id from public.pos_businesses where id=p_business for update;
  select * into previous from pos_private.pos_requests where business_id=p_business and id=p_request;
  if found then
    if previous.command<>'terminal_sync' or previous.payload<>p_payload then raise exception 'Operación ya utilizada'; end if;
    return previous.result;
  end if;
  if jsonb_typeof(p_payload->'products') is distinct from 'array' or jsonb_typeof(p_payload->'sales') is distinct from 'array'
     or jsonb_typeof(p_payload->'shifts') is distinct from 'array' or jsonb_typeof(p_payload->'cycles') is distinct from 'array' then raise exception 'Datos incompletos'; end if;
  if jsonb_array_length(p_payload->'products')>5000 or jsonb_array_length(p_payload->'sales')>500 then raise exception 'Lote demasiado grande'; end if;
  select coalesce(jsonb_object_agg(id,revision),'{}'::jsonb) into revisions from public.pos_products where business_id=p_business;
  if revisions is distinct from p_payload->'expected' then raise exception 'La nube cambió: revisa el conflicto antes de publicar'; end if;
  if (select count(*) from jsonb_array_elements(p_payload->'products'))<>(select count(distinct value->>'id') from jsonb_array_elements(p_payload->'products')) then raise exception 'Productos duplicados'; end if;
  for entry in select value from jsonb_array_elements(p_payload->'products') loop
    qty:=(entry->>'stock')::integer;cold_qty:=(entry->>'cold_stock')::integer;
    if qty is null or cold_qty is null or qty<0 or cold_qty<0 or cold_qty>qty or coalesce(length(entry->>'id'),0) not between 1 and 200
      or coalesce(length(entry->'data'->>'nombre'),0) not between 1 and 100 then raise exception 'Producto inválido'; end if;
    foreach v_price in array array[(entry->'data'->>'precioVenta')::numeric,(entry->'data'->>'precioCarton')::numeric,(entry->'data'->>'costoPieza')::numeric,(entry->'data'->>'costoCarton')::numeric] loop
      if v_price is null or v_price<0 or v_price::text in ('NaN','Infinity','-Infinity') then raise exception 'Precio inválido'; end if;
    end loop;
    insert into public.pos_products(business_id,id,data,stock,cold_stock) values(p_business,entry->>'id',entry->'data',qty,cold_qty)
      on conflict(business_id,id) do update set data=excluded.data,stock=excluded.stock,cold_stock=excluded.cold_stock,revision=public.pos_products.revision+1,updated_at=now()
      where public.pos_products.data is distinct from excluded.data or public.pos_products.stock<>excluded.stock or public.pos_products.cold_stock<>excluded.cold_stock;
  end loop;
  update public.pos_products p set stock=0,cold_stock=0,data=p.data||'{"activo":false}'::jsonb,revision=p.revision+1,updated_at=now()
    where p.business_id=p_business and (p.stock<>0 or coalesce((p.data->>'activo')::boolean,true))
    and not exists(select 1 from jsonb_array_elements(p_payload->'products') x where x->>'id'=p.id);

  for sale in select value from jsonb_array_elements(p_payload->'sales') loop
    total:=(sale->>'total_cents')::bigint;
    if total is null or total<0 or coalesce(length(sale->>'id'),0) not between 1 and 200 or coalesce(length(sale->>'cashier_name'),0) not between 1 and 100
      or coalesce(length(sale->>'cashier_id'),0) not between 1 and 200 or jsonb_typeof(sale->'items') is distinct from 'array'
      or sale->>'status' not in ('completed','cancelled') then raise exception 'Ticket inválido'; end if;
    if jsonb_array_length(sale->'items') not between 1 and 100 then raise exception 'Partidas inválidas'; end if;
    if coalesce((sale->'payment'->>'cash_cents')::bigint,0)+coalesce((sale->'payment'->>'card_cents')::bigint,0)+coalesce((sale->'payment'->>'transfer_cents')::bigint,0)<>total
      or coalesce((sale->'payment'->>'cash_cents')::bigint,0)<0 or coalesce((sale->'payment'->>'card_cents')::bigint,0)<0 or coalesce((sale->'payment'->>'transfer_cents')::bigint,0)<0 then raise exception 'Pago inválido'; end if;
    select * into old from public.pos_terminal_sales where business_id=p_business and installation=device.installation and id=sale->>'id';
    if found then
      if old.total_cents<>total or old.cashier_id<>sale->>'cashier_id' or old.payment<>sale->'payment' then raise exception 'El ticket ya registrado tiene otros datos'; end if;
      if (select count(*) from public.pos_terminal_items where business_id=p_business and installation=device.installation and sale_id=old.id)<>jsonb_array_length(sale->'items') then raise exception 'El detalle del ticket ya registrado cambió'; end if;
      n:=0;
      for item in select value from jsonb_array_elements(sale->'items') loop
        n:=n+1;
        if not exists(select 1 from public.pos_terminal_items i where i.business_id=p_business and i.installation=device.installation and i.sale_id=old.id and i.line=n and i.product_id=item->>'product_id' and i.quantity=(item->>'quantity')::integer and i.total_cents=(item->>'total_cents')::bigint and i.cost_cents is not distinct from (item->>'cost_cents')::bigint) then raise exception 'La partida ya registrada cambió'; end if;
      end loop;
      if sale->>'status'='cancelled' then update public.pos_terminal_sales set status='cancelled' where business_id=p_business and installation=device.installation and id=old.id; end if;
      continue;
    end if;
    insert into public.pos_terminal_sales values(p_business,device.installation,sale->>'id',sale->>'shift_id',sale->>'cashier_id',sale->>'cashier_name',coalesce(sale->>'cashier_role','legacy'),total,sale->'payment',(sale->>'created_at')::timestamptz,sale->>'status');
    n:=0;line_sum:=0;
    for item in select value from jsonb_array_elements(sale->'items') loop
      n:=n+1;qty:=(item->>'quantity')::integer;
      if qty is null or qty<=0 or (item->>'total_cents')::bigint is null or (item->>'total_cents')::bigint<0 or coalesce((item->'snapshot'->>'container_cents')::bigint,0)<0
        or jsonb_typeof(item->'snapshot') is distinct from 'object' or coalesce(length(item->>'product_id'),0) not between 1 and 200 then raise exception 'Partida inválida'; end if;
      if not exists(select 1 from public.pos_products where business_id=p_business and id=item->>'product_id') then
        insert into public.pos_products(business_id,id,data,stock,cold_stock) values(p_business,item->>'product_id',(item->'snapshot')||'{"activo":false}'::jsonb,0,0);
      end if;
      insert into public.pos_terminal_items values(p_business,device.installation,sale->>'id',n,item->>'product_id',qty,coalesce((item->>'cold')::boolean,false),item->'snapshot',(item->>'total_cents')::bigint,(item->>'cost_cents')::bigint);
      line_sum:=line_sum+(item->>'total_cents')::bigint;
    end loop;
    if line_sum<>total then raise exception 'El detalle no coincide con el total'; end if;
  end loop;
  for entry in select value from jsonb_array_elements(p_payload->'shifts') loop
    insert into public.pos_terminal_shifts values(p_business,device.installation,entry->>'id',entry->>'cashier_name',(entry->>'opening_cents')::bigint,(entry->>'opened_at')::timestamptz,(entry->>'closed_at')::timestamptz,(entry->>'counted_cents')::bigint)
      on conflict(business_id,installation,id) do update set closed_at=coalesce(public.pos_terminal_shifts.closed_at,excluded.closed_at),counted_cents=coalesce(excluded.counted_cents,public.pos_terminal_shifts.counted_cents);
  end loop;
  insert into public.pos_documents(business_id,kind,data) values(p_business,'inventory_cycles',p_payload->'cycles')
    on conflict(business_id,kind) do update set data=excluded.data,revision=public.pos_documents.revision+1;
  select coalesce(jsonb_object_agg(id,revision),'{}'::jsonb) into revisions from public.pos_products where business_id=p_business;
  result:=jsonb_build_object('revisions',revisions,'accepted_sales',(select coalesce(jsonb_agg(value->>'id'),'[]'::jsonb) from jsonb_array_elements(p_payload->'sales')),'synced_at',now());
  update pos_private.terminals set last_sync_at=now() where business_id=p_business and auth_user_id=auth.uid();
  insert into pos_private.pos_requests(business_id,id,user_id,command,payload,result) values(p_business,p_request,auth.uid(),'terminal_sync',p_payload,result);
  return result;
end $$;
revoke all on function pos_private.terminal_sync(uuid,uuid,jsonb) from public,anon;
grant execute on function pos_private.terminal_sync(uuid,uuid,jsonb) to authenticated;
create function public.pos_terminal_sync(p_business uuid,p_request uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select pos_private.terminal_sync(p_business,p_request,p_payload); $$;
revoke all on function public.pos_terminal_sync(uuid,uuid,jsonb) from public,anon;
grant execute on function public.pos_terminal_sync(uuid,uuid,jsonb) to authenticated;

create view public.pos_reporting_sales with(security_invoker=true) as
  select business_id,id::text,shift_id::text,user_id::text,cashier_name,total_cents,payment,created_at from public.pos_sales
  union all select business_id,installation::text||':'||id,installation::text||':'||shift_id,installation::text||':'||cashier_id,cashier_name,total_cents,payment,created_at from public.pos_terminal_sales where status='completed';
create view public.pos_reporting_items with(security_invoker=true) as
  select business_id,sale_id::text,line,product_id,quantity,cold,snapshot,total_cents,cost_cents from public.pos_sale_items
  union all select business_id,installation::text||':'||sale_id,line,product_id,quantity,cold,snapshot,total_cents,cost_cents from public.pos_terminal_items i
    where exists(select 1 from public.pos_terminal_sales s where s.business_id=i.business_id and s.installation=i.installation and s.id=i.sale_id and s.status='completed');
create view public.pos_reporting_shifts with(security_invoker=true) as
  select business_id,id::text,user_id::text,register_name,opening_cents,opened_at,closed_at,counted_cents,null::text as cashier_name from public.pos_shifts
  union all select business_id,installation::text||':'||id,null::text,'Terminal vinculada',opening_cents,opened_at,closed_at,counted_cents,cashier_name from public.pos_terminal_shifts;
revoke all on public.pos_reporting_sales,public.pos_reporting_items,public.pos_reporting_shifts from public,anon,authenticated;
grant select on public.pos_reporting_sales,public.pos_reporting_items,public.pos_reporting_shifts to authenticated;

create function pos_private.terminal_link(p_business uuid,p_revoke boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.pos_has_access(p_business,true) then raise exception 'Requiere administrador'; end if;
  if p_revoke then update pos_private.terminals set active=false where business_id=p_business; end if;
  return (select jsonb_build_object('active',active,'label',label,'last_sync_at',last_sync_at,'enrolled_at',enrolled_at) from pos_private.terminals where business_id=p_business);
end $$;
revoke all on function pos_private.terminal_link(uuid,boolean) from public,anon;
grant execute on function pos_private.terminal_link(uuid,boolean) to authenticated;
create function public.pos_terminal_link(p_business uuid,p_revoke boolean default false) returns jsonb
language sql security invoker set search_path='' as $$ select pos_private.terminal_link(p_business,p_revoke); $$;
revoke all on function public.pos_terminal_link(uuid,boolean) from public,anon;
grant execute on function public.pos_terminal_link(uuid,boolean) to authenticated;
