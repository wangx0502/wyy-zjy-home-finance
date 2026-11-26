create table public.ledger_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.ledger_admins enable row level security;
revoke all on public.ledger_admins from public, anon, authenticated;
grant select on public.ledger_admins to authenticated;
create policy "Read own authorization" on public.ledger_admins
  for select to authenticated using (user_id = (select auth.uid()));

create table public.ledgers (
  user_id uuid primary key references public.ledger_admins(user_id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  document jsonb not null check (
    jsonb_typeof(document) = 'object' and document @> '{"schema":1}' and
    document ?& array['accounts', 'transactions', 'categories', 'rules', 'learned', 'history']
  ),
  updated_at timestamptz not null default now()
);
alter table public.ledgers enable row level security;
revoke all on public.ledgers from public, anon, authenticated;
grant select on public.ledgers to authenticated;
create policy "Read own ledger" on public.ledgers
  for select to authenticated using (
    user_id = (select auth.uid()) and exists (
      select 1 from public.ledger_admins where user_id = (select auth.uid())
    )
  );

create function public.save_ledger(expected_revision bigint, next_document jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  saved_revision bigint;
begin
  if actor is null or not exists (select 1 from public.ledger_admins where user_id = actor) then
    raise exception 'Ledger access denied' using errcode = '42501';
  end if;

  if expected_revision is null then
    insert into public.ledgers(user_id, document)
    values (actor, next_document)
    on conflict (user_id) do nothing
    returning revision into saved_revision;
  else
    update public.ledgers
    set document = next_document, revision = revision + 1, updated_at = now()
    where user_id = actor and revision = expected_revision
    returning revision into saved_revision;
  end if;

  if saved_revision is null then
    raise exception 'Ledger revision conflict' using errcode = '40001';
  end if;

  return saved_revision;
end;
$$;
revoke all on function public.save_ledger(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_ledger(bigint, jsonb) to authenticated;
