create table public.export_auction_rows (
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 kind text not null check (kind in ('listing','result')),
 row_key text not null check (length(row_key) between 1 and 400),
 auction_day date not null,
 data jsonb not null check (jsonb_typeof(data)='object' and octet_length(data::text)<12000),
 primary key(owner_id,kind,row_key)
);
create index export_auction_rows_day on public.export_auction_rows(owner_id,auction_day,kind,row_key);
create table public.export_auction_uploads (
 owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
 file_name text not null check(length(file_name) between 1 and 240),
 uploaded_at timestamptz not null default now(),
 primary key(owner_id,file_hash)
);
alter table public.export_auction_rows enable row level security;
alter table public.export_auction_uploads enable row level security;
revoke all on public.export_auction_rows,public.export_auction_uploads from public,anon,authenticated;
grant select,insert on public.export_auction_rows,public.export_auction_uploads to authenticated;
create policy export_auction_owner_read on public.export_auction_rows for select to authenticated using (owner_id=(select auth.uid()));
create policy export_auction_owner_insert on public.export_auction_rows for insert to authenticated with check (owner_id=(select auth.uid()));
create policy export_auction_upload_read on public.export_auction_uploads for select to authenticated using (owner_id=(select auth.uid()));
create policy export_auction_upload_insert on public.export_auction_uploads for insert to authenticated with check (owner_id=(select auth.uid()));
create function public.export_auction_import(p_hash text,p_name text,p_kind text,p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer; conflicts integer;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if p_kind is null or p_kind not in ('listing','result') or jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Invalid import'; end if;
 if jsonb_array_length(p_rows) not between 1 and 15000 then raise exception 'Invalid row count'; end if;
 insert into public.export_auction_uploads(file_hash,file_name) values(p_hash,p_name) on conflict do nothing;
 if not found then return jsonb_build_object('duplicate',true); end if;
 insert into public.export_auction_rows(kind,row_key,auction_day,data)
 select p_kind,r->>'key',(r->>'day')::date,r->'data' from jsonb_array_elements(p_rows) r
 on conflict do nothing;
 get diagnostics n=row_count;
 select count(*) into conflicts from jsonb_array_elements(p_rows) r
 join public.export_auction_rows a on a.owner_id=auth.uid() and a.kind=p_kind and a.row_key=r->>'key'
 where a.data is distinct from r->'data' or a.auction_day is distinct from (r->>'day')::date;
 return jsonb_build_object('inserted',n,'unchanged',jsonb_array_length(p_rows)-n-conflicts,'conflicts',conflicts);
end $$;
revoke all on function public.export_auction_import(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.export_auction_import(text,text,text,jsonb) to authenticated;
