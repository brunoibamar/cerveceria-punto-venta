create function public.pos_snapshot(p_business uuid) returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'business',to_jsonb(b),
    'member',(select to_jsonb(m) from public.pos_members m where m.business_id=b.id and m.user_id=(select auth.uid()) and m.active),
    'products',coalesce((select jsonb_agg(p order by p.data->>'nombre') from public.pos_products p where p.business_id=b.id),'[]'::jsonb),
    'shifts',coalesce((select jsonb_agg(s order by s.opened_at desc) from (select * from public.pos_shifts where business_id=b.id order by opened_at desc limit 200) s),'[]'::jsonb),
    'sales',coalesce((select jsonb_agg(s order by s.created_at desc) from (select * from public.pos_sales where business_id=b.id order by created_at desc limit 500) s),'[]'::jsonb),
    'documents',coalesce((select jsonb_object_agg(d.kind,d.data) from public.pos_documents d where d.business_id=b.id),'{}'::jsonb),
    'today',coalesce((select jsonb_agg(t) from (select cashier_name,user_id,count(*) as tickets,sum(total_cents) as total_cents from public.pos_sales
      where business_id=b.id and (created_at at time zone 'America/Mexico_City')::date=(now() at time zone 'America/Mexico_City')::date
      group by cashier_name,user_id) t),'[]'::jsonb),
    'read_at',now()
  ) from public.pos_businesses b where b.id=p_business and public.pos_has_access(b.id);
$$;
revoke all on function public.pos_snapshot(uuid) from public,anon;
grant execute on function public.pos_snapshot(uuid) to authenticated;
