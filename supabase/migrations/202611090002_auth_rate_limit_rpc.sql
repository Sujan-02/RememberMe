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

notify pgrst, 'reload schema';
