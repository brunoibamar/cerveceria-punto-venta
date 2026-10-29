-- Operaciones de negocio serializadas por negocio, con reintentos idempotentes.
create table pos_private.pos_requests (
  business_id uuid not null references public.pos_businesses(id),
  id uuid not null,
  user_id uuid not null references auth.users(id),
  command text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(business_id,id)
);
alter table pos_private.pos_requests enable row level security;
create index pos_requests_user_idx on pos_private.pos_requests(user_id);
revoke all on pos_private.pos_requests from public,anon,authenticated;
create policy no_client_access on pos_private.pos_access to authenticated using(false) with check(false);
create policy no_client_access on pos_private.pos_requests to authenticated using(false) with check(false);

create function pos_private.cents(v numeric) returns bigint language sql immutable security invoker set search_path='' as $$
  select round(v*100)::bigint;
$$;
revoke all on function pos_private.cents(numeric) from public,anon,authenticated;

create function pos_private.command(p_business uuid,p_request uuid,p_command text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  member public.pos_members;
  previous pos_private.pos_requests;
  product public.pos_products;
  shift public.pos_shifts;
  line jsonb;
  item jsonb;
  data jsonb;
  result jsonb;
  items jsonb:='[]';
  qty integer;
  pack integer;
  full_packs integer;
  loose integer;
  price bigint;
  cost bigint;
  extra bigint;
  total bigint:=0;
  paid bigint;
  n integer:=0;
  cold boolean;
  missing boolean;
  v_id uuid;
  expected bigint;
  payment jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión'; end if;
  if p_request is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Solicitud inválida'; end if;
  -- Una sola transacción por negocio evita conflictos entre inventario, ventas y cortes.
  perform id from public.pos_businesses where id=p_business for update;
  select * into member from public.pos_members where business_id=p_business and user_id=auth.uid() and active;
  if not found then raise exception 'Acceso no autorizado'; end if;
  select * into previous from pos_private.pos_requests where business_id=p_business and id=p_request;
  if found then
    if previous.user_id<>auth.uid() or previous.command<>p_command or previous.payload<>p_payload then
      raise exception 'El identificador de operación ya fue usado con otros datos';
    end if;
    return previous.result;
  end if;

  if p_command='open_shift' then
    paid:=(p_payload->>'opening_cents')::bigint;
    if paid is null or paid<0 then raise exception 'Fondo de apertura inválido'; end if;
    insert into public.pos_shifts(business_id,user_id,opening_cents)
      values(p_business,auth.uid(),paid) returning id into v_id;
    result:=jsonb_build_object('id',v_id);

  elsif p_command='close_shift' then
    select * into shift from public.pos_shifts where business_id=p_business and id=(p_payload->>'id')::uuid and closed_at is null for update;
    if not found or shift.user_id<>auth.uid() then raise exception 'Solo el cajero responsable puede cerrar su turno'; end if;
    paid:=(p_payload->>'counted_cents')::bigint;
    if paid is null or paid<0 then raise exception 'Conteo inválido'; end if;
    select shift.opening_cents+coalesce(sum((s.payment->>'cash_cents')::bigint),0) into expected
      from public.pos_sales s where s.business_id=p_business and s.shift_id=shift.id;
    update public.pos_shifts set closed_at=now(),counted_cents=paid where business_id=p_business and id=shift.id;
    result:=jsonb_build_object('id',shift.id,'expected_cents',expected,'counted_cents',paid,'difference_cents',paid-expected);

  elsif p_command='sale' then
    select * into shift from public.pos_shifts where business_id=p_business and id=(p_payload->>'shift_id')::uuid and user_id=auth.uid() and closed_at is null for update;
    if not found then raise exception 'Abre tu turno antes de cobrar'; end if;
    if (shift.opened_at at time zone 'America/Mexico_City')::date < (now() at time zone 'America/Mexico_City')::date then raise exception 'Cierra el turno pendiente antes de vender'; end if;
    if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Ticket inválido'; end if;
    if jsonb_array_length(p_payload->'items') not between 1 and 100 then raise exception 'Ticket inválido'; end if;
    select d.data into data from public.pos_documents d where business_id=p_business and kind='settings';
    for line in select value from jsonb_array_elements(p_payload->'items') loop
      qty:=(line->>'quantity')::integer;
      if qty is null or qty not between 1 and 100000 then raise exception 'Cantidad inválida'; end if;
      select * into product from public.pos_products where business_id=p_business and id=line->>'product_id' for update;
      if not found or coalesce((product.data->>'activo')::boolean,true)=false then raise exception 'Producto no disponible'; end if;
      if product.revision is distinct from (line->>'revision')::bigint then raise exception 'El catálogo cambió. Actualiza el ticket'; end if;
      cold:=coalesce((line->>'cold')::boolean,false);
      missing:=coalesce((line->>'missing_container')::boolean,false);
      if product.stock<qty or (cold and product.cold_stock<qty) or (not cold and product.stock-product.cold_stock<qty) then raise exception 'Existencias insuficientes para %',product.data->>'nombre'; end if;
      pack:=greatest(coalesce((product.data->>'unidadesPorCarton')::integer,0),0);
      full_packs:=case when pack>0 and coalesce((product.data->>'precioCarton')::numeric,0)>0 then qty/pack else 0 end;
      loose:=qty-full_packs*pack;
      price:=pos_private.cents(full_packs*coalesce((product.data->>'precioCarton')::numeric,0)+loose*coalesce((product.data->>'precioVenta')::numeric,(product.data->>'precio')::numeric,0));
      cost:=pos_private.cents(full_packs*coalesce((product.data->>'costoCarton')::numeric,0)+loose*coalesce((product.data->>'costoPieza')::numeric,(product.data->>'precioCompra')::numeric,0));
      extra:=0;
      if cold then extra:=extra+qty*pos_private.cents(coalesce((data->>'coldCharge')::numeric,0)); end if;
      if missing then extra:=extra+pos_private.cents(full_packs*coalesce((product.data->>'cobroExtraEnvaseFaltanteCarton')::numeric,0)+loose*coalesce((product.data->>'cobroExtraEnvaseFaltantePieza')::numeric,0)); end if;
      if price<0 or cost<0 or extra<0 then raise exception 'Precio o costo inválido'; end if;
      n:=n+1;
      items:=items||jsonb_build_array(jsonb_build_object('line',n,'product_id',product.id,'quantity',qty,'cold',cold,'snapshot',product.data||jsonb_build_object('missing_container',missing),'total_cents',price+extra,'cost_cents',cost));
      total:=total+price+extra;
      update public.pos_products set stock=stock-qty,cold_stock=cold_stock-case when cold then qty else 0 end,updated_at=now()
        where business_id=p_business and id=product.id;
    end loop;
    update public.pos_products set revision=revision+1 where business_id=p_business
      and id in (select distinct value->>'product_id' from jsonb_array_elements(items));
    if (p_payload->>'expected_total_cents')::bigint is distinct from total then raise exception 'El total cambió. Revisa el ticket'; end if;
    payment:=p_payload->'payment';
    paid:=coalesce((payment->>'cash_cents')::bigint,0)+coalesce((payment->>'card_cents')::bigint,0)+coalesce((payment->>'transfer_cents')::bigint,0);
    if payment is null or paid<>total or coalesce((payment->>'cash_cents')::bigint,0)<0 or coalesce((payment->>'card_cents')::bigint,0)<0 or coalesce((payment->>'transfer_cents')::bigint,0)<0 then raise exception 'El pago no coincide con el total'; end if;
    if coalesce((payment->>'transfer_cents')::bigint,0)>0 and (length(trim(coalesce(payment->>'reference','')))=0 or coalesce(payment->>'verified','false')<>'true') then raise exception 'Confirma la transferencia recibida y su referencia'; end if;
    if coalesce((payment->>'card_cents')::bigint,0)>0 then
      payment:=payment||jsonb_build_object('card_status','cashier-declared','bank_verified',false,'declared_by',auth.uid());
    end if;
    insert into public.pos_sales(business_id,id,shift_id,user_id,cashier_name,total_cents,payment)
      values(p_business,p_request,shift.id,auth.uid(),member.display_name,total,payment);
    for item in select value from jsonb_array_elements(items) loop
      insert into public.pos_sale_items(business_id,sale_id,line,product_id,quantity,cold,snapshot,total_cents,cost_cents)
        values(p_business,p_request,(item->>'line')::integer,item->>'product_id',(item->>'quantity')::integer,(item->>'cold')::boolean,item->'snapshot',(item->>'total_cents')::bigint,(item->>'cost_cents')::bigint);
      insert into public.pos_inventory_movements(business_id,product_id,user_id,units,reason,sale_id)
        values(p_business,item->>'product_id',auth.uid(),-(item->>'quantity')::integer,'sale',p_request);
    end loop;
    result:=jsonb_build_object('id',p_request,'total_cents',total,'items',items);

  else
    if member.role<>'admin' then raise exception 'Esta acción requiere administrador'; end if;
    if p_command='grant_employee' then
      if coalesce(length(p_payload->>'email'),0) not between 5 and 254 or position('@' in p_payload->>'email')=0 or coalesce(length(trim(p_payload->>'name')),0) not between 1 and 100 then raise exception 'Nombre o correo inválido'; end if;
      insert into pos_private.pos_access(business_id,email,display_name,role)
        values(p_business,lower(trim(p_payload->>'email')),trim(p_payload->>'name'),'employee') on conflict(business_id,email) do nothing;
      result:=jsonb_build_object('authorized',true);
    elsif p_command='save_product' then
      data:=p_payload->'data';
      if jsonb_typeof(data) is distinct from 'object' or coalesce(length(trim(data->>'nombre')),0) not between 1 and 100 then raise exception 'Producto inválido'; end if;
      qty:=(p_payload->>'stock')::integer;
      n:=coalesce((p_payload->>'cold_stock')::integer,0);
      if qty is null or qty<0 or n<0 or n>qty then raise exception 'Existencias inválidas'; end if;
      foreach price in array array[pos_private.cents((data->>'precioVenta')::numeric),pos_private.cents((data->>'precioCarton')::numeric),pos_private.cents((data->>'costoPieza')::numeric),pos_private.cents((data->>'costoCarton')::numeric),pos_private.cents((data->>'cobroExtraEnvaseFaltantePieza')::numeric),pos_private.cents((data->>'cobroExtraEnvaseFaltanteCarton')::numeric)] loop
        if price is null or price<0 then raise exception 'Precio o costo inválido'; end if;
      end loop;
      if (data->>'unidadesPorCarton')::integer is null or (data->>'unidadesPorCarton')::integer<0 then raise exception 'Presentación inválida'; end if;
      select * into product from public.pos_products where business_id=p_business and id=p_payload->>'id' for update;
      if found then
        if product.revision is distinct from (p_payload->>'revision')::bigint then raise exception 'El producto cambió en otro dispositivo. Actualiza antes de guardar'; end if;
        insert into public.pos_inventory_movements(business_id,product_id,user_id,units,reason) values(p_business,product.id,auth.uid(),qty-product.stock,'admin-adjustment');
        update public.pos_products set data=p_payload->'data',stock=qty,cold_stock=n,revision=revision+1,updated_at=now() where business_id=p_business and id=product.id;
      else
        insert into public.pos_products(business_id,id,data,stock,cold_stock) values(p_business,p_payload->>'id',data,qty,n);
        insert into public.pos_inventory_movements(business_id,product_id,user_id,units,reason) values(p_business,p_payload->>'id',auth.uid(),qty,'initial-stock');
      end if;
      result:=jsonb_build_object('id',p_payload->>'id');
    elsif p_command='save_settings' then
      data:=p_payload->'data';
      if jsonb_typeof(data)<>'object' or (data->>'coldCharge')::numeric is null or (data->>'coldCharge')::numeric<0 then raise exception 'Configuración inválida'; end if;
      insert into public.pos_documents(business_id,kind,data) values(p_business,'settings',data)
        on conflict(business_id,kind) do update set data=excluded.data,revision=public.pos_documents.revision+1;
      result:=jsonb_build_object('saved',true);
    else raise exception 'Operación no disponible'; end if;
  end if;
  insert into pos_private.pos_requests(business_id,id,user_id,command,payload,result) values(p_business,p_request,auth.uid(),p_command,p_payload,result);
  return result;
end $$;
revoke all on function pos_private.command(uuid,uuid,text,jsonb) from public,anon;
grant execute on function pos_private.command(uuid,uuid,text,jsonb) to authenticated;
create function public.pos_command(p_business uuid,p_request uuid,p_command text,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select pos_private.command(p_business,p_request,p_command,p_payload);
$$;
revoke all on function public.pos_command(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.pos_command(uuid,uuid,text,jsonb) to authenticated;
