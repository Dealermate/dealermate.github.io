-- Run once in this project's Supabase SQL Editor. Safe to run again.
-- Adds purchase inspection sharing without changing broker inspection sharing.
begin;
create table if not exists public.purchase_report_shares (
 owner_id uuid not null references auth.users(id) on delete cascade,
 record_id text not null,
 share_token text not null unique,
 snapshot jsonb not null,
 published_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 primary key(owner_id,record_id)
);
alter table public.purchase_report_shares enable row level security;
revoke all on public.purchase_report_shares from public,anon,authenticated;

create or replace function public.publish_purchase_report(p_record_id text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=auth.uid();
 v_token text:=replace(gen_random_uuid()::text,'-','');
 v_expiry timestamptz:=now()+interval '7 days';
 v_snapshot jsonb;
 v_section jsonb;
 v_count integer:=0;
begin
 if v_owner is null then raise exception 'Login required'; end if;
 if not exists(select 1 from public.inspection_records r where r.id::text=p_record_id
  and r.user_id=v_owner and coalesce(nullif(r.workspace->>'kind',''),'purchase')='purchase')
 then raise exception 'Purchase inspection not found'; end if;
 if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
  or octet_length(p_snapshot::text)>200000
  or p_snapshot->>'version' is distinct from '1'
  or jsonb_typeof(p_snapshot->'sections') is distinct from 'array'
 then raise exception 'Invalid report'; end if;
 if jsonb_array_length(p_snapshot->'sections')<1 or jsonb_array_length(p_snapshot->'sections')>20
 then raise exception 'Invalid report sections'; end if;
 for v_section in select value from jsonb_array_elements(p_snapshot->'sections') loop
  if jsonb_typeof(v_section) is distinct from 'object'
   or jsonb_typeof(v_section->'rows') is distinct from 'array'
  then raise exception 'Invalid report rows'; end if;
  if jsonb_array_length(v_section->'rows')>1000 then raise exception 'Too many report rows'; end if;
  v_count:=v_count+jsonb_array_length(v_section->'rows');
 end loop;
 if v_count>3000 then raise exception 'Too many report rows'; end if;
 -- Only the visible report snapshot is shared; full workspace and photos stay private.
 v_snapshot:=jsonb_build_object('version',1,'created',now(),
  'carNumber',left(coalesce(p_snapshot->>'carNumber',''),100),
  'bidPrice',left(coalesce(p_snapshot->>'bidPrice','0'),100),
  'sections',p_snapshot->'sections');
 insert into public.purchase_report_shares(owner_id,record_id,share_token,snapshot,published_at,expires_at,revoked_at)
 values(v_owner,p_record_id,v_token,v_snapshot,now(),v_expiry,null)
 on conflict(owner_id,record_id) do update set share_token=excluded.share_token,
  snapshot=excluded.snapshot,published_at=excluded.published_at,expires_at=excluded.expires_at,revoked_at=null;
 return jsonb_build_object('token',v_token,'expiresAt',v_expiry);
end $$;

create or replace function public.get_purchase_report_share(p_record_id text)
returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('token',s.share_token,'expiresAt',s.expires_at)
 from public.purchase_report_shares s
 where s.owner_id=auth.uid() and s.record_id=p_record_id and s.revoked_at is null and s.expires_at>now()
 and exists(select 1 from public.inspection_records r where r.id::text=s.record_id
  and r.user_id=s.owner_id and coalesce(nullif(r.workspace->>'kind',''),'purchase')='purchase');
$$;

create or replace function public.revoke_purchase_report(p_record_id text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 update public.purchase_report_shares set revoked_at=now() where owner_id=auth.uid() and record_id=p_record_id;
 return found;
end $$;

create or replace function public.read_purchase_report(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 if p_token is null or p_token !~ '^[0-9a-f]{32}$' then return null; end if;
 select jsonb_build_object('report',s.snapshot,'publishedAt',s.published_at,'expiresAt',s.expires_at)
 into v_result from public.purchase_report_shares s
 where s.share_token=p_token and s.revoked_at is null and s.expires_at>now()
 and exists(select 1 from public.inspection_records r where r.id::text=s.record_id
  and r.user_id=s.owner_id and coalesce(nullif(r.workspace->>'kind',''),'purchase')='purchase');
 return v_result;
end $$;
revoke all on function public.publish_purchase_report(text,jsonb) from public,anon,authenticated;
revoke all on function public.get_purchase_report_share(text) from public,anon,authenticated;
revoke all on function public.revoke_purchase_report(text) from public,anon,authenticated;
revoke all on function public.read_purchase_report(text) from public,anon,authenticated;
grant execute on function public.publish_purchase_report(text,jsonb) to authenticated;
grant execute on function public.get_purchase_report_share(text) to authenticated;
grant execute on function public.revoke_purchase_report(text) to authenticated;
grant execute on function public.read_purchase_report(text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
