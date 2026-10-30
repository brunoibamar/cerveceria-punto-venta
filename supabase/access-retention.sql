-- Permisos de consulta: costos y datos administrativos solo para administradores.
do $$ declare t text; begin
  foreach t in array array['pos_products','pos_documents','pos_sale_items','pos_inventory_movements','pos_terminal_sales','pos_terminal_items','pos_terminal_shifts'] loop
    execute format('alter policy business_read on public.%I using(public.pos_has_access(business_id,true))',t);
  end loop;
end $$;
alter policy business_read on public.pos_sales using(public.pos_has_access(business_id,true) or (public.pos_has_access(business_id) and user_id=(select auth.uid())));
alter policy business_read on public.pos_shifts using(public.pos_has_access(business_id,true) or (public.pos_has_access(business_id) and user_id=(select auth.uid())));

create function pos_private.employee_snapshot(p_business uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.pos_has_access(p_business) then return null; end if;
  select jsonb_build_object('business',to_jsonb(b),'member',(select to_jsonb(m) from public.pos_members m where m.business_id=b.id and m.user_id=auth.uid()),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'business_id',p.business_id,'stock',p.stock,'cold_stock',0,'revision',p.revision,
      'data',(select coalesce(jsonb_object_agg(k,v),'{}'::jsonb) from jsonb_each(p.data) e(k,v) where k=any(array['nombre','marca','presentacion','categoria','codigoBarras','precio','precioVenta','unidadesPorCarton','precioCarton','cobroExtraEnvaseFaltantePieza','cobroExtraEnvaseFaltanteCarton','promocionesVolumen','promocionesPorPieza','activo'])))) from public.pos_products p where p.business_id=b.id),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(s) from public.pos_shifts s where s.business_id=b.id and s.user_id=auth.uid()),'[]'::jsonb),'sales','[]'::jsonb,'today','[]'::jsonb,
    'documents',jsonb_build_object('settings',coalesce((select jsonb_build_object('coldCharge',d.data->'coldCharge','currencySymbol',d.data->'currencySymbol') from public.pos_documents d where d.business_id=b.id and d.kind='settings'),'{}'::jsonb)), 'read_at',now()) into result
  from public.pos_businesses b where b.id=p_business;
  return result;
end $$;
revoke all on function pos_private.employee_snapshot(uuid) from public,anon;
grant execute on function pos_private.employee_snapshot(uuid) to authenticated;
create function public.pos_employee_snapshot(p_business uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select pos_private.employee_snapshot(p_business); $$;
revoke all on function public.pos_employee_snapshot(uuid) from public,anon;
grant execute on function public.pos_employee_snapshot(uuid) to authenticated;

create table pos_private.retention (
 business_id uuid primary key references public.pos_businesses(id), before_at timestamptz not null,
 deleted_by uuid not null references auth.users(id), deleted_at timestamptz not null default now()
);
alter table pos_private.retention enable row level security;
create policy no_client_access on pos_private.retention to authenticated using(false) with check(false);
revoke all on pos_private.retention from public,anon,authenticated;

-- Solo el año más antiguo, completo y sin turnos abiertos o cruzando la fecha límite.
create function pos_private.history_archive(p_business uuid,p_year integer default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare oldest integer; cutoff timestamptz; data jsonb;
begin
 if auth.uid() is null or not public.pos_has_access(p_business,true) then raise exception 'Requiere administrador'; end if;
 select min(extract(year from (d at time zone 'America/Mexico_City'))::integer) into oldest from (
  select created_at d from public.pos_sales where business_id=p_business union all select created_at from public.pos_terminal_sales where business_id=p_business
  union all select opened_at from public.pos_shifts where business_id=p_business and closed_at is not null
  union all select opened_at from public.pos_terminal_shifts where business_id=p_business and closed_at is not null
  union all select created_at from public.pos_inventory_movements where business_id=p_business
 ) dates;
 if oldest is null or oldest>=extract(year from now() at time zone 'America/Mexico_City') then return jsonb_build_object('year',null,'message','No hay años antiguos completos para limpiar.'); end if;
 if p_year is not null and p_year<>oldest then raise exception 'Solo se permite el año más antiguo: %',oldest; end if;
 cutoff:=make_date(oldest+1,1,1)::timestamp at time zone 'America/Mexico_City';
 if exists(select 1 from public.pos_shifts where business_id=p_business and opened_at<cutoff and (closed_at is null or closed_at>=cutoff))
 or exists(select 1 from public.pos_terminal_shifts where business_id=p_business and opened_at<cutoff and (closed_at is null or closed_at>=cutoff)) then raise exception 'Hay turnos abiertos o que cruzan ese año. No se puede limpiar.'; end if;
 select jsonb_build_object('sales',coalesce((select jsonb_agg(s) from public.pos_sales s where business_id=p_business and created_at<cutoff),'[]'),
 'items',coalesce((select jsonb_agg(i) from public.pos_sale_items i join public.pos_sales s on s.business_id=i.business_id and s.id=i.sale_id where s.business_id=p_business and s.created_at<cutoff),'[]'),
 'terminal_sales',coalesce((select jsonb_agg(s) from public.pos_terminal_sales s where business_id=p_business and created_at<cutoff),'[]'),
 'terminal_items',coalesce((select jsonb_agg(i) from public.pos_terminal_items i join public.pos_terminal_sales s on s.business_id=i.business_id and s.installation=i.installation and s.id=i.sale_id where s.business_id=p_business and s.created_at<cutoff),'[]'),
 'shifts',coalesce((select jsonb_agg(s) from public.pos_shifts s where business_id=p_business and closed_at<cutoff),'[]'),
 'terminal_shifts',coalesce((select jsonb_agg(s) from public.pos_terminal_shifts s where business_id=p_business and closed_at<cutoff),'[]'),
 'movements',coalesce((select jsonb_agg(m) from public.pos_inventory_movements m where business_id=p_business and (created_at<cutoff or sale_id in(select id from public.pos_sales where business_id=p_business and created_at<cutoff))),'[]'),
 'cycles',coalesce((select jsonb_agg(c) from public.pos_documents d cross join lateral jsonb_array_elements(d.data) c where d.business_id=p_business and d.kind='inventory_cycles' and c->>'status'='closed' and (c->>'closedAt')::timestamptz<cutoff),'[]')) into data;
 return jsonb_build_object('year',oldest,'before_at',cutoff,'data',data,'fingerprint',md5(data::text));
end $$;
revoke all on function pos_private.history_archive(uuid,integer) from public,anon;
grant execute on function pos_private.history_archive(uuid,integer) to authenticated;
create function public.pos_history_archive(p_business uuid,p_year integer default null) returns jsonb language sql stable security invoker set search_path='' as $$ select pos_private.history_archive(p_business,p_year); $$;
revoke all on function public.pos_history_archive(uuid,integer) from public,anon;
grant execute on function public.pos_history_archive(uuid,integer) to authenticated;

create function pos_private.prune_history(p_business uuid,p_year integer,p_fingerprint text,p_confirmation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare archive jsonb; cutoff timestamptz;
begin
 if auth.uid() is null or not public.pos_has_access(p_business,true) then raise exception 'Requiere administrador'; end if;
 perform id from public.pos_businesses where id=p_business for update;
 archive:=pos_private.history_archive(p_business,p_year);
 if archive->>'year' is null or archive->>'fingerprint' is distinct from p_fingerprint or p_confirmation is distinct from 'ELIMINAR '||p_year::text then raise exception 'Descarga un respaldo actualizado y confirma el año'; end if;
 cutoff:=(archive->>'before_at')::timestamptz;
 delete from public.pos_inventory_movements where business_id=p_business and (created_at<cutoff or sale_id in(select id from public.pos_sales where business_id=p_business and created_at<cutoff));
 delete from public.pos_sale_items where business_id=p_business and sale_id in(select id from public.pos_sales where business_id=p_business and created_at<cutoff);
 delete from public.pos_sales where business_id=p_business and created_at<cutoff;
 delete from public.pos_terminal_items i using public.pos_terminal_sales s where i.business_id=p_business and s.business_id=i.business_id and s.installation=i.installation and s.id=i.sale_id and s.created_at<cutoff;
 delete from public.pos_terminal_sales where business_id=p_business and created_at<cutoff;
 delete from public.pos_shifts where business_id=p_business and closed_at<cutoff;
 delete from public.pos_terminal_shifts where business_id=p_business and closed_at<cutoff;
 update public.pos_documents d set data=(select coalesce(jsonb_agg(c),'[]') from jsonb_array_elements(d.data) c where not(coalesce(c->>'status','')='closed' and coalesce((c->>'closedAt')::timestamptz,'infinity')<cutoff)),revision=revision+1 where business_id=p_business and kind='inventory_cycles';
 -- Conserva identificadores idempotentes sin guardar copias completas de los tickets eliminados.
 update pos_private.pos_requests set payload='{}',result='{}',command='archived' where business_id=p_business and created_at<cutoff;
 insert into pos_private.retention(business_id,before_at,deleted_by) values(p_business,cutoff,auth.uid()) on conflict(business_id) do update set before_at=greatest(pos_private.retention.before_at,excluded.before_at),deleted_by=excluded.deleted_by,deleted_at=now();
 return jsonb_build_object('year',p_year,'before_at',cutoff,'deleted',true);
end $$;
revoke all on function pos_private.prune_history(uuid,integer,text,text) from public,anon;
grant execute on function pos_private.prune_history(uuid,integer,text,text) to authenticated;
create function public.pos_prune_history(p_business uuid,p_year integer,p_fingerprint text,p_confirmation text) returns jsonb language sql security invoker set search_path='' as $$ select pos_private.prune_history(p_business,p_year,p_fingerprint,p_confirmation); $$;
revoke all on function public.pos_prune_history(uuid,integer,text,text) from public,anon;
grant execute on function public.pos_prune_history(uuid,integer,text,text) to authenticated;
