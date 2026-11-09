create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '',
  has_email boolean not null default false,
  recovery_hash text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy "Profiles can be read by their owner"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.create_rememberme_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  candidate_username text;
  base_username text;
  suffix text;
  inserted_rows integer;
begin
  requested_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  if requested_username is not null then
    candidate_username := lower(requested_username);
    if candidate_username !~ '^[a-z0-9_]{3,24}$' then
      raise exception 'Username is invalid' using errcode = '23514';
    end if;
    insert into public.profiles (user_id, username, display_name, has_email)
    values (
      new.id,
      candidate_username,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
      new.email is not null and lower(new.email) not like '%@accounts.rememberme.invalid'
    );
    return new;
  end if;

  requested_username := split_part(coalesce(new.email, 'friend'), '@', 1);
  base_username := trim(both '_' from regexp_replace(lower(requested_username), '[^a-z0-9_]+', '_', 'g'));
  if length(base_username) < 3 then
    base_username := 'friend';
  end if;
  base_username := left(base_username, 24);
  candidate_username := base_username;

  loop
    insert into public.profiles (user_id, username, display_name, has_email)
    values (
      new.id,
      candidate_username,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
      new.email is not null and lower(new.email) not like '%@accounts.rememberme.invalid'
    )
    on conflict (username) do nothing;
    get diagnostics inserted_rows = row_count;
    exit when inserted_rows = 1;
    suffix := '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 7);
    candidate_username := left(base_username, 24 - length(suffix)) || suffix;
  end loop;
  return new;
end;
$$;

revoke all on function public.create_rememberme_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_rememberme on auth.users;
create trigger on_auth_user_created_rememberme
  after insert on auth.users
  for each row execute procedure public.create_rememberme_profile();

create table if not exists public.occasions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  date date not null,
  category text not null check (category in ('Birthday', 'Anniversary', 'College event', 'Festival', 'Meeting', 'Personal', 'Other')),
  notes text not null default '' check (char_length(notes) <= 240),
  repeat_yearly boolean not null default true,
  legacy_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, legacy_id)
);

create index if not exists occasions_user_date_idx on public.occasions (user_id, date);
alter table public.occasions enable row level security;
revoke all on public.occasions from anon, authenticated;
grant select, insert, update, delete on public.occasions to authenticated;
grant all on public.occasions to service_role;

create policy "Users can read only their occasions"
  on public.occasions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create only their occasions"
  on public.occasions for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update only their occasions"
  on public.occasions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete only their occasions"
  on public.occasions for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_occasion_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_occasion_updated_at on public.occasions;
create trigger set_occasion_updated_at
  before update on public.occasions
  for each row execute procedure public.set_occasion_updated_at();

create table if not exists public.auth_rate_limits (
  bucket text primary key check (char_length(bucket) = 64),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts >= 0)
);

alter table public.auth_rate_limits enable row level security;
revoke all on public.auth_rate_limits from public, anon, authenticated;
grant all on public.auth_rate_limits to service_role;

create or replace function public.consume_auth_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket_row public.auth_rate_limits%rowtype;
begin
  if p_bucket !~ '^[a-f0-9]{64}$' or p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit parameters';
  end if;

  insert into public.auth_rate_limits (bucket, window_started_at, attempts)
  values (p_bucket, now(), 0)
  on conflict (bucket) do nothing;

  select * into bucket_row
  from public.auth_rate_limits
  where bucket = p_bucket
  for update;

  if bucket_row.window_started_at <= now() - make_interval(secs => p_window_seconds) then
    update public.auth_rate_limits
    set window_started_at = now(), attempts = 1
    where bucket = p_bucket;
    return true;
  end if;

  if bucket_row.attempts >= p_limit then
    return false;
  end if;

  update public.auth_rate_limits
  set attempts = attempts + 1
  where bucket = p_bucket;
  return true;
end;
$$;

revoke all on function public.consume_auth_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text, integer, integer) to service_role;
