-- One row per auth user. Created automatically by a trigger on signup, never by the client.

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Any signed-in user can read display names: you need to see your partner's name in a match.
create policy "profiles readable by authenticated"
  on public.profiles for select to authenticated using (true);

create policy "users update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- No insert/delete policy: rows come only from the trigger below.

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      split_part(new.email, '@', 1)
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
