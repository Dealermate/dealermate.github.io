-- Run in this project's Supabase SQL Editor. Safe to run again.
-- Enables explicit same-link report updates and vehicle-number links.
-- Existing 64-character links remain valid; new shares use 32-character tokens.
begin;

create table if not exists public.broker_report_shares (
  owner_id uuid not null references auth.users(id) on delete cascade,
  record_id text not null,
  share_token text not null unique,
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  primary key (owner_id, record_id)
);
alter table public.broker_report_shares add column if not exists vehicle_number text not null default '';
alter table public.broker_report_shares add column if not exists updated_at timestamptz;
alter table public.broker_report_shares enable row level security;
revoke all on public.broker_report_shares from public, anon, authenticated;

create or replace function public.publish_broker_report(p_record_id text, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid();
  v_token text;
  v_expiry timestamptz := now() + interval '7 days' - interval '10 minutes';
  v_snapshot jsonb;
  v_vehicle text;
begin
  if v_owner is null then raise exception 'Login required'; end if;
  if not exists (select 1 from public.inspection_records r
    where r.id::text = p_record_id and r.user_id = v_owner and r.workspace->>'kind' = 'broker')
    then raise exception 'Broker inspection not found'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or octet_length(p_snapshot::text) > 2000000
    or jsonb_typeof(p_snapshot->'fields') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'exterior') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'detail') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'accidents') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'photos') is distinct from 'array'
    then raise exception 'Invalid report'; end if;
  -- Share only buyer report fields, never the full inspection workspace.
  v_snapshot := jsonb_build_object('fields',p_snapshot->'fields',
    'exterior',p_snapshot->'exterior','detail',p_snapshot->'detail',
    'accidents',p_snapshot->'accidents','note',p_snapshot->'note','photos',p_snapshot->'photos');
  v_token := replace(gen_random_uuid()::text, '-', '');
  select left(regexp_replace(coalesce(f->>'value',''), '[^0-9가-힣A-Za-z]', '', 'g'),32) into v_vehicle
    from jsonb_array_elements(v_snapshot->'fields') f where f->>'label'='차량번호' limit 1;
  insert into public.broker_report_shares(owner_id,record_id,share_token,snapshot,published_at,expires_at,revoked_at,vehicle_number,updated_at)
    values(v_owner,p_record_id,v_token,v_snapshot,now(),v_expiry,null,coalesce(v_vehicle,''),now())
    on conflict(owner_id,record_id) do update set share_token=excluded.share_token,
      snapshot=excluded.snapshot,published_at=excluded.published_at,
      expires_at=excluded.expires_at,revoked_at=null,vehicle_number=excluded.vehicle_number,updated_at=excluded.updated_at;
  return jsonb_build_object('token',v_token,'expiresAt',v_expiry,'vehicleNumber',coalesce(v_vehicle,''),'updatedAt',now());
end $$;


-- Explicitly refresh the published snapshot without rotating or reviving its link.
create or replace function public.update_broker_report(p_record_id text,p_snapshot jsonb,p_expected_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_owner uuid:=auth.uid();
 v_share public.broker_report_shares%rowtype;
 v_snapshot jsonb;
 v_expiry timestamptz:=now()+interval '7 days'-interval '10 minutes';
begin
 if v_owner is null then raise exception 'Login required'; end if;
 if not exists(select 1 from public.inspection_records r where r.id::text=p_record_id
   and r.user_id=v_owner and r.workspace->>'kind'='broker') then raise exception 'Broker inspection not found'; end if;
 select * into v_share from public.broker_report_shares
   where owner_id=v_owner and record_id=p_record_id for update;
 if not found or v_share.revoked_at is not null or v_share.expires_at<=now()
   then raise exception 'Share ended. Create a new link.'; end if;
 if p_expected_token is distinct from v_share.share_token then raise exception 'Share link changed. Reload before updating.'; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or octet_length(p_snapshot::text) > 2000000
    or jsonb_typeof(p_snapshot->'fields') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'exterior') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'detail') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'accidents') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'photos') is distinct from 'array'
    then raise exception 'Invalid report'; end if;
  -- Share only buyer report fields, never the full inspection workspace.
  v_snapshot := jsonb_build_object('fields',p_snapshot->'fields',
    'exterior',p_snapshot->'exterior','detail',p_snapshot->'detail',
    'accidents',p_snapshot->'accidents','note',p_snapshot->'note','photos',p_snapshot->'photos');

 update public.broker_report_shares set snapshot=v_snapshot,updated_at=now(),expires_at=v_expiry
   where owner_id=v_owner and record_id=p_record_id;
 return jsonb_build_object('token',v_share.share_token,'expiresAt',v_expiry,
   'vehicleNumber',v_share.vehicle_number,'updatedAt',now());
end $$;

create or replace function public.get_broker_report_share(p_record_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('token',s.share_token,'expiresAt',s.expires_at,'vehicleNumber',s.vehicle_number,'updatedAt',coalesce(s.updated_at,s.published_at),
    'photoUrls',coalesce((select jsonb_agg(p->>'url') from jsonb_array_elements(s.snapshot->'photos') p),'[]'::jsonb))
  from public.broker_report_shares s
  where s.owner_id=auth.uid() and s.record_id=p_record_id
    and s.revoked_at is null and s.expires_at>now()
    and exists(select 1 from public.inspection_records r where r.id::text=s.record_id
      and r.user_id=s.owner_id and r.workspace->>'kind'='broker');
$$;

create or replace function public.revoke_broker_report(p_record_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  update public.broker_report_shares set revoked_at=now()
    where owner_id=auth.uid() and record_id=p_record_id;
  return found;
end $$;

create or replace function public.read_broker_report(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if p_token is null or p_token !~ '^([0-9a-f]{32}|[0-9a-f]{64})$' then return null; end if;
  select jsonb_build_object('report',s.snapshot,'publishedAt',s.published_at,'updatedAt',coalesce(s.updated_at,s.published_at),'expiresAt',s.expires_at)
    into v_result from public.broker_report_shares s
    where s.share_token=p_token and s.revoked_at is null and s.expires_at>now()
      and exists(select 1 from public.inspection_records r where r.id::text=s.record_id
        and r.user_id=s.owner_id and r.workspace->>'kind'='broker');
  return v_result;
end $$;

revoke all on function public.update_broker_report(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.update_broker_report(text,jsonb,text) to authenticated;
revoke all on function public.publish_broker_report(text,jsonb) from public,anon,authenticated;
revoke all on function public.get_broker_report_share(text) from public,anon,authenticated;
revoke all on function public.revoke_broker_report(text) from public,anon,authenticated;
revoke all on function public.read_broker_report(text) from public,anon,authenticated;
grant execute on function public.publish_broker_report(text,jsonb) to authenticated;
grant execute on function public.get_broker_report_share(text) to authenticated;
grant execute on function public.revoke_broker_report(text) to authenticated;
grant execute on function public.read_broker_report(text) to anon,authenticated;
notify pgrst, 'reload schema';
commit;

