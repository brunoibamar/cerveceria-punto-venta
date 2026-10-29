-- Base compartida. Este archivo es fuente SQL; no modifica el almacenamiento local.
create schema if not exists pos_private;
revoke all on schema pos_private from public, anon, authenticated;

create table public.pos_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.pos_members (
  business_id uuid not null references public.pos_businesses(id),
  user_id uuid not null references auth.users(id),
  display_name text not null check (length(display_name) between 1 and 100),
  role text not null check (role in ('admin','employee')),
  active boolean not null default true,
  primary key (business_id,user_id)
);
create index pos_members_user_idx on public.pos_members(user_id,business_id) where active;
create table pos_private.pos_access (
  business_id uuid not null references public.pos_businesses(id),
  email text not null check (email=lower(email)),
  display_name text not null,
  role text not null check (role in ('admin','employee')),
  primary key(business_id,email)
);
alter table pos_private.pos_access enable row level security;
revoke all on pos_private.pos_access from public,anon,authenticated;

create table public.pos_products (
  business_id uuid not null references public.pos_businesses(id),
  id text not null,
  data jsonb not null check(jsonb_typeof(data)='object'),
  stock integer not null default 0 check(stock>=0),
  cold_stock integer not null default 0 check(cold_stock>=0 and cold_stock<=stock),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key(business_id,id)
);
create table public.pos_shifts (
  business_id uuid not null,
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  register_name text not null default 'Caja principal',
  opening_cents bigint not null check(opening_cents>=0),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  counted_cents bigint check(counted_cents>=0),
  primary key(business_id,id),
  foreign key(business_id,user_id) references public.pos_members(business_id,user_id)
);
create unique index pos_one_open_register on public.pos_shifts(business_id,register_name) where closed_at is null;
create unique index pos_one_shift_per_user on public.pos_shifts(business_id,user_id) where closed_at is null;
create table public.pos_sales (
  business_id uuid not null,
  id uuid not null,
  shift_id uuid not null,
  user_id uuid not null,
  cashier_name text not null,
  total_cents bigint not null check(total_cents>=0),
  payment jsonb not null check(jsonb_typeof(payment)='object'),
  created_at timestamptz not null default now(),
  primary key(business_id,id),
  foreign key(business_id,shift_id) references public.pos_shifts(business_id,id),
  foreign key(business_id,user_id) references public.pos_members(business_id,user_id)
);
create index pos_sales_period_idx on public.pos_sales(business_id,created_at desc);
create index pos_sales_shift_idx on public.pos_sales(business_id,shift_id);
create index pos_sales_cashier_idx on public.pos_sales(business_id,user_id,created_at desc);
create table public.pos_sale_items (
  business_id uuid not null,
  sale_id uuid not null,
  line integer not null check(line>0),
  product_id text not null,
  quantity integer not null check(quantity>0),
  cold boolean not null,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  total_cents bigint not null check(total_cents>=0),
  cost_cents bigint check(cost_cents>=0),
  primary key(business_id,sale_id,line),
  foreign key(business_id,sale_id) references public.pos_sales(business_id,id),
  foreign key(business_id,product_id) references public.pos_products(business_id,id)
);
create index pos_sale_items_product_idx on public.pos_sale_items(business_id,product_id);
create table public.pos_inventory_movements (
  business_id uuid not null,
  id uuid not null default gen_random_uuid(),
  product_id text not null,
  user_id uuid not null,
  units integer not null,
  reason text not null,
  sale_id uuid,
  created_at timestamptz not null default now(),
  primary key(business_id,id),
  foreign key(business_id,product_id) references public.pos_products(business_id,id),
  foreign key(business_id,user_id) references public.pos_members(business_id,user_id),
  foreign key(business_id,sale_id) references public.pos_sales(business_id,id)
);
create index pos_inventory_product_idx on public.pos_inventory_movements(business_id,product_id,created_at desc);
create index pos_inventory_user_idx on public.pos_inventory_movements(business_id,user_id);
create index pos_inventory_sale_idx on public.pos_inventory_movements(business_id,sale_id);
create table public.pos_documents (
  business_id uuid not null references public.pos_businesses(id),
  kind text not null check(kind in ('settings','promotions','inventory_cycles','legacy_sales','legacy_cuts')),
  data jsonb not null,
  revision bigint not null default 1,
  primary key(business_id,kind)
);

-- Los permisos dependen de membresías guardadas en el servidor, nunca de user_metadata.
create function public.pos_has_access(p_business uuid,p_admin boolean default false)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.pos_members m where m.business_id=p_business
    and m.user_id=(select auth.uid()) and m.active and (not p_admin or m.role='admin'));
$$;
revoke all on function public.pos_has_access(uuid,boolean) from public,anon;
grant execute on function public.pos_has_access(uuid,boolean) to authenticated;

alter table public.pos_members enable row level security;
revoke all on public.pos_members from public,anon,authenticated;
grant select on public.pos_members to authenticated;
create policy member_self on public.pos_members for select to authenticated using(user_id=(select auth.uid()));

do $$ declare t text; begin
  foreach t in array array['pos_businesses','pos_products','pos_shifts','pos_sales','pos_sale_items','pos_inventory_movements','pos_documents'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    if t='pos_businesses' then
      execute format('create policy business_read on public.%I for select to authenticated using(public.pos_has_access(id))',t);
    else
      execute format('create policy business_read on public.%I for select to authenticated using(public.pos_has_access(business_id))',t);
    end if;
  end loop;
end $$;

-- Única función privilegiada de esta etapa: reclamar una invitación preautorizada.
-- No acepta correo ni rol del cliente; exige el correo confirmado en auth.users.
create function pos_private.claim_access()
returns void language plpgsql security definer set search_path='' as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  select lower(email) into v_email from auth.users where id=auth.uid() and email_confirmed_at is not null;
  if v_email is null then raise exception 'Confirma tu correo antes de continuar'; end if;
  insert into public.pos_members(business_id,user_id,display_name,role)
    select business_id,auth.uid(),display_name,role from pos_private.pos_access where email=v_email
    on conflict(business_id,user_id) do nothing;
  if not exists(select 1 from public.pos_members where user_id=auth.uid() and active) then
    raise exception 'Tu cuenta no tiene acceso autorizado a este negocio';
  end if;
end $$;
revoke all on function pos_private.claim_access() from public,anon;
grant usage on schema pos_private to authenticated;
grant execute on function pos_private.claim_access() to authenticated;
create function public.pos_claim_access() returns void language sql security invoker set search_path='' as $$
  select pos_private.claim_access();
$$;
revoke all on function public.pos_claim_access() from public,anon;
grant execute on function public.pos_claim_access() to authenticated;

-- Los clientes no pueden escribir directamente ventas, stock, turnos ni membresías.
-- Se habilitarán únicamente mediante operaciones transaccionales verificadas.
do $$ declare t text; begin
  foreach t in array array['pos_products','pos_shifts','pos_sales','pos_inventory_movements','pos_documents'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
      execute format('alter publication supabase_realtime add table public.%I',t);
    end if;
  end loop;
end $$;
