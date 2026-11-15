-- The handful of Supabase-provided objects our migrations depend on, so they can run on a
-- bare Postgres. Mirrors Supabase's defaults: anon/authenticated get table and function
-- privileges on everything in public, and RLS is the thing that actually restricts them.
create role anon nologin;
create role authenticated nologin;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

grant usage on schema auth, public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create publication supabase_realtime;
