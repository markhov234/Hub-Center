-- Live match state. There is no game server: these rows ARE the game server.
-- Both phones subscribe to `matches` and `match_players` over Supabase Realtime and
-- drive the match forward by calling the RPCs in the next migration.

create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  deck_id       uuid not null references public.decks (id),
  host_id       uuid not null references public.profiles (id),
  status        text not null default 'lobby' check (status in ('lobby', 'playing', 'done')),
  round_index   int  not null default 0,
  round_count   int  not null default 10 check (round_count between 1 and 50),
  round_seconds int  not null default 15 check (round_seconds between 5 and 120),
  round_started_at timestamptz,
  created_at    timestamptz not null default now()
);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  score    int  not null default 0,
  primary key (match_id, user_id)
);

create index match_players_user_idx on public.match_players (user_id);

-- `answer` is the index into `choices` of the right option. Clients must never read it
-- while the round is live, which is why this table has RLS on and NO select policy:
-- clients read rounds through the `round_views` view below instead.
create table public.rounds (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches (id) on delete cascade,
  idx        int  not null check (idx > 0),
  word_id    uuid not null references public.words (id),
  direction  text not null check (direction in ('fr_to_ko', 'ko_to_fr')),
  prompt     text not null,
  choices    text[] not null check (array_length(choices, 1) = 4),
  answer     int  not null check (answer between 0 and 3),
  created_at timestamptz not null default now(),
  unique (match_id, idx)
);

create table public.answers (
  round_id    uuid not null references public.rounds (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  choice      int  not null check (choice between 0 and 3),
  correct     boolean not null,
  answered_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

alter table public.matches       enable row level security;
alter table public.match_players enable row level security;
alter table public.rounds        enable row level security;
alter table public.answers       enable row level security;

-- A policy on match_players that queries match_players recurses forever. This definer
-- function bypasses RLS, which breaks the cycle. Every membership check goes through it.
create function public.is_match_player(p_match_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.match_players p
    where p.match_id = p_match_id and p.user_id = auth.uid()
  );
$$;

create policy "players read their match"
  on public.matches for select to authenticated
  using (public.is_match_player(id));

create policy "players read the scoreboard"
  on public.match_players for select to authenticated
  using (public.is_match_player(match_id));

-- Own answers only. If players could read each other's rows they would see `correct`
-- for the live round over Realtime, which gives away the right option.
create policy "players read their own answers"
  on public.answers for select to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policies anywhere above: all writes go through the RPCs.

-- Reads of the live round, with `answer` withheld until the round is over.
-- security_invoker = false means the view runs as its owner and so is not blocked by the
-- empty policy set on `rounds`; the where-clause below is what authorises the caller.
create view public.round_views
with (security_invoker = false) as
select
  r.id,
  r.match_id,
  r.idx,
  r.direction,
  r.prompt,
  r.choices,
  case when r.idx < m.round_index or m.status = 'done' then r.answer end as answer
from public.rounds r
join public.matches m on m.id = r.match_id
where public.is_match_player(r.match_id);

revoke all on public.round_views from anon;
grant select on public.round_views to authenticated;

-- Realtime: the two tables holding no secrets. Clients re-fetch the round from
-- round_views whenever matches.round_index changes.
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_players;
