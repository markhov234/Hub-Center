-- Vocabulary and the decks that group it.
-- `verified` is false for anything an LLM produced: unreviewed words never reach a match.

create table public.words (
  id         uuid primary key default gen_random_uuid(),
  fr         text not null check (length(trim(fr)) > 0),
  ko         text not null check (length(trim(ko)) > 0),
  ko_romaja  text,
  en_gloss   text,
  topic      text not null,
  level      text not null check (level in ('beginner', 'intermediate', 'advanced')),
  verified   boolean not null default false,
  created_at timestamptz not null default now(),
  unique (fr, ko)
);

create index words_verified_idx on public.words (verified) where verified;

create table public.decks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  topic      text not null,
  level      text not null check (level in ('beginner', 'intermediate', 'advanced')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.deck_words (
  deck_id uuid not null references public.decks (id) on delete cascade,
  word_id uuid not null references public.words (id) on delete cascade,
  primary key (deck_id, word_id)
);

create index deck_words_word_idx on public.deck_words (word_id);

alter table public.words      enable row level security;
alter table public.decks      enable row level security;
alter table public.deck_words enable row level security;

create policy "words readable by authenticated"
  on public.words for select to authenticated using (true);
create policy "decks readable by authenticated"
  on public.decks for select to authenticated using (true);
create policy "deck_words readable by authenticated"
  on public.deck_words for select to authenticated using (true);

-- shortcut: every signed-in user can verify and delete words, because the only two accounts
-- are the two of us and we both own the content. Add an is_admin flag on profiles and gate
-- these two policies on it the moment a third person gets an account.
create policy "authenticated verify words"
  on public.words for update to authenticated using (true) with check (true);
create policy "authenticated delete words"
  on public.words for delete to authenticated using (true);

-- Inserts come from the generate-deck edge function on the service-role key, which
-- bypasses RLS, so there is deliberately no insert policy here.
