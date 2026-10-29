create function public.pos_report(p_business uuid,p_from date,p_to date,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if not public.pos_has_access(p_business,true) then raise exception 'Esta consulta requiere administrador'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_offset<0 then raise exception 'Período inválido'; end if;
  with sales as (
    select * from public.pos_sales where business_id=p_business
      and created_at >= (p_from::timestamp at time zone 'America/Mexico_City')
      and created_at < ((p_to+1)::timestamp at time zone 'America/Mexico_City')
  ), items as (
    select i.*,s.cashier_name,s.user_id from public.pos_sale_items i join sales s on s.business_id=i.business_id and s.id=i.sale_id
  ), item_totals as (
    select coalesce(sum(quantity),0) as units,coalesce(sum(cost_cents),0) as cost_cents,
      count(*) filter(where cost_cents is null) as unknown_costs,
      coalesce(sum(case when coalesce((snapshot->>'missing_container')::boolean,false) then
        round(100*(
          case when coalesce((snapshot->>'unidadesPorCarton')::integer,0)>0 and coalesce((snapshot->>'precioCarton')::numeric,0)>0
          then (quantity/(snapshot->>'unidadesPorCarton')::integer)*coalesce((snapshot->>'cobroExtraEnvaseFaltanteCarton')::numeric,0)
            +(quantity%(snapshot->>'unidadesPorCarton')::integer)*coalesce((snapshot->>'cobroExtraEnvaseFaltantePieza')::numeric,0)
          else quantity*coalesce((snapshot->>'cobroExtraEnvaseFaltantePieza')::numeric,0) end))::bigint
        else 0 end),0) as container_cents from items
  ), product_totals as (
    select product_id,sum(quantity) as units,sum(total_cents) as total_cents from items group by product_id
  ), employees as (
    select s.user_id,max(s.cashier_name) as cashier_name,count(*) as tickets,sum(s.total_cents) as total_cents,
      (select coalesce(sum(i.quantity),0) from items i where i.user_id=s.user_id) as units
    from sales s group by s.user_id
  ), product_employees as (
    select product_id,max(snapshot->>'nombre') as product_name,user_id,max(cashier_name) as cashier_name,
      sum(quantity) as units,sum(total_cents) as total_cents from items group by product_id,user_id
  ), history as (
    select s.*, (select jsonb_agg(jsonb_build_object('name',i.snapshot->>'nombre','quantity',i.quantity,'cold',i.cold,'total_cents',i.total_cents) order by i.line)
      from items i where i.sale_id=s.id) as items from sales s order by created_at desc,id desc limit 50 offset p_offset
  )
  select jsonb_build_object(
    'from',p_from,'to',p_to,'offset',p_offset,'page_size',50,
    'totals',(select jsonb_build_object('tickets',count(*),'total_cents',coalesce(sum(total_cents),0),
      'cash_cents',coalesce(sum((payment->>'cash_cents')::bigint),0),
      'card_cents',coalesce(sum((payment->>'card_cents')::bigint),0),
      'transfer_cents',coalesce(sum((payment->>'transfer_cents')::bigint),0)) from sales),
    'costs',(select to_jsonb(t) from item_totals t),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.data->>'nombre','units',coalesce(t.units,0),'total_cents',coalesce(t.total_cents,0)) order by coalesce(t.units,0) desc,p.data->>'nombre')
      from public.pos_products p left join product_totals t on t.product_id=p.id where p.business_id=p_business),'[]'::jsonb),
    'employees',coalesce((select jsonb_agg(e order by total_cents desc) from employees e),'[]'::jsonb),
    'product_employees',coalesce((select jsonb_agg(e order by units desc) from product_employees e),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(h order by created_at desc,id desc) from history h),'[]'::jsonb),
    'read_at',now()
  ) into result;
  return result;
end $$;
revoke all on function public.pos_report(uuid,date,date,integer) from public,anon;
grant execute on function public.pos_report(uuid,date,date,integer) to authenticated;
