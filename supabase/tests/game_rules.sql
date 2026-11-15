-- Plays one 3-round match as two players (A, B) with an outsider (C) poking at it.
-- Plain asserts, no pgTAP: run with `npm run test:sql`, or paste into the Supabase SQL
-- editor. Everything happens in one transaction that is rolled back at the end.
--
-- now() is frozen at transaction start, so "time passing" is simulated by backdating
-- matches.round_started_at.

begin;

-- ---------- fixtures (as the table owner) ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.com');

do $$ begin
  assert (select display_name from public.profiles
          where id = '00000000-0000-0000-0000-00000000000a') = 'alice',
    'signup trigger should create a profile named after the email';
end $$;

insert into public.decks (id, name, topic, level)
values ('00000000-0000-0000-0000-0000000000d1', 'test deck', 'test', 'beginner');

with w as (
  insert into public.words (fr, ko, topic, level, verified) values
    ('eau', '물', 'test', 'beginner', true),
    ('pain', '빵', 'test', 'beginner', true),
    ('chat', '고양이', 'test', 'beginner', true),
    ('chien', '개', 'test', 'beginner', true),
    ('livre', '책', 'test', 'beginner', true),
    ('mer', '바다', 'test', 'beginner', true)
  returning id
), junk as (
  -- 30 unverified words against 6 verified: if the verified filter ever goes missing,
  -- one of these lands in a round almost surely
  insert into public.words (fr, ko, topic, level, verified)
  select 'unverified-' || n, '미확인-' || n, 'test', 'beginner', false from generate_series(1, 30) n
  returning id
), w_all as (
  select id from w union all select id from junk
)
insert into public.deck_words (deck_id, word_id)
select '00000000-0000-0000-0000-0000000000d1', id from w_all;

-- 4 verified words but only 3 distinct French texts: a "Korean to French" round could not
-- find 3 wrong options, so this deck must be refused at the door
insert into public.decks (id, name, topic, level)
values ('00000000-0000-0000-0000-0000000000d2', 'ambiguous deck', 'test2', 'beginner');

with w as (
  insert into public.words (fr, ko, topic, level, verified) values
    ('café', '커피', 'test2', 'beginner', true),
    ('café', '카페', 'test2', 'beginner', true),
    ('thé', '차', 'test2', 'beginner', true),
    ('lait', '우유', 'test2', 'beginner', true)
  returning id
)
insert into public.deck_words (deck_id, word_id)
select '00000000-0000-0000-0000-0000000000d2', id from w;

-- ---------- A creates a match ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';

do $$
declare m public.matches;
begin
  m := public.create_match('00000000-0000-0000-0000-0000000000d1', 3, 15);
  assert m.status = 'lobby' and length(m.code) = 6, 'new match starts in the lobby with a 6-char code';
  perform set_config('test.match_id', m.id::text, true);
  perform set_config('test.code', m.code, true);

  begin
    perform public.create_match('00000000-0000-0000-0000-0000000000d1', 7, 15);
    assert false, 'a deck with 6 verified words must not allow 7 rounds';
  exception when raise_exception then null;
  end;

  begin
    perform public.create_match('00000000-0000-0000-0000-0000000000d2', 2, 15);
    assert false, 'a deck with fewer than 4 distinct translations must be refused';
  exception when raise_exception then null;
  end;

  begin
    perform public.new_round(m.id, 1);
    assert false, 'clients must not be able to call new_round directly';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- B cannot see it until they join; joining starts it ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';

do $$
declare m public.matches;
begin
  assert (select count(*) from public.matches) = 0, 'RLS: a non-player sees no matches';

  begin
    perform public.join_match('NOPE00');
    assert false, 'a wrong code must be rejected';
  exception when raise_exception then null;
  end;

  m := public.join_match(lower(current_setting('test.code')));
  assert m.status = 'playing' and m.round_index = 1, 'second player joining starts round 1';
  assert (select count(*) from public.match_players) = 2, 'both players are on the scoreboard';

  assert (select count(*) from public.rounds) = 0, 'RLS: the rounds table itself is unreadable';
  assert (select count(*) from public.round_views) = 1, 'the live round is readable through the view';
  assert (select answer from public.round_views) is null, 'the answer is withheld while the round is live';
  assert (select array_length(choices, 1) from public.round_views) = 4, 'a round has 4 choices';
end $$;

-- peek at the truth as the owner so the players can answer deliberately right/wrong
reset role;
select set_config('test.round_id', id::text, true), set_config('test.answer', answer::text, true)
from public.rounds where match_id = current_setting('test.match_id')::uuid and idx = 1;

-- ---------- A answers right, twice; cannot advance alone ----------
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';

do $$
declare
  rid uuid := current_setting('test.round_id')::uuid;
  mid uuid := current_setting('test.match_id')::uuid;
  ans int  := current_setting('test.answer')::int;
  m   public.matches;
begin
  assert public.submit_answer(rid, ans) = ans, 'submit_answer returns the right option';
  perform public.submit_answer(rid, ans);
  assert (select score from public.match_players where user_id = auth.uid()) = 1,
    'answering right twice scores once';
  perform public.submit_answer(rid, (ans + 1) % 4);
  assert (select choice from public.answers) = ans, 'the first answer is the one that is kept';

  m := public.advance_round(mid, 1);
  assert m.round_index = 1, 'cannot advance while the other player still has time to answer';
end $$;

-- ---------- the outsider gets nothing ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000c"}';

do $$ begin
  assert (select count(*) from public.matches) = 0
     and (select count(*) from public.match_players) = 0
     and (select count(*) from public.round_views) = 0
     and (select count(*) from public.answers) = 0, 'RLS: an outsider sees nothing of the match';

  begin
    perform public.submit_answer(current_setting('test.round_id')::uuid, 0);
    assert false, 'an outsider must not be able to answer';
  exception when raise_exception then null;
  end;

  begin
    perform public.advance_round(current_setting('test.match_id')::uuid, 1);
    assert false, 'an outsider must not be able to advance the match';
  exception when raise_exception then null;
  end;

  begin
    insert into public.answers (round_id, user_id, choice, correct)
    values (current_setting('test.round_id')::uuid, auth.uid(), 0, true);
    assert false, 'direct inserts into answers must be blocked';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- B answers wrong; either player advancing twice moves one round ----------
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';

do $$
declare
  rid uuid := current_setting('test.round_id')::uuid;
  mid uuid := current_setting('test.match_id')::uuid;
  ans int  := current_setting('test.answer')::int;
  m   public.matches;
begin
  assert (select count(*) from public.answers) = 0, 'RLS: B cannot read A''s answer';
  perform public.submit_answer(rid, (ans + 1) % 4);
  assert (select score from public.match_players where user_id = auth.uid()) = 0, 'a wrong answer scores nothing';

  m := public.advance_round(mid, 1);
  assert m.round_index = 2, 'advances once everyone has answered';
  m := public.advance_round(mid, 1);
  assert m.round_index = 2, 'a second advance for the same round is a no-op';

  assert (select answer from public.round_views where idx = 1) = ans, 'a finished round reveals its answer';
  assert (select answer from public.round_views where idx = 2) is null, 'the new live round does not';

  begin
    perform public.submit_answer(rid, 0);
    assert false, 'answering a finished round must be rejected';
  exception when raise_exception then null;
  end;
end $$;

-- ---------- the clock runs out on round 2 ----------
reset role;
update public.matches set round_started_at = now() - interval '1 minute'
where id = current_setting('test.match_id')::uuid;
select set_config('test.round_id', id::text, true)
from public.rounds where match_id = current_setting('test.match_id')::uuid and idx = 2;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';

do $$
declare
  mid uuid := current_setting('test.match_id')::uuid;
  m   public.matches;
begin
  begin
    perform public.submit_answer(current_setting('test.round_id')::uuid, 0);
    assert false, 'an answer after the deadline must be rejected';
  exception when raise_exception then null;
  end;

  m := public.advance_round(mid, 2);
  assert m.round_index = 3, 'after the deadline the round advances with nobody having answered';
end $$;

-- ---------- last round ends the match ----------
reset role;
update public.matches set round_started_at = now() - interval '1 minute'
where id = current_setting('test.match_id')::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';

do $$
declare
  mid uuid := current_setting('test.match_id')::uuid;
  m   public.matches;
begin
  -- round 3 is past its deadline, so only the expected-index check stands between a
  -- late duplicate call for round 2 and the match ending a round early
  m := public.advance_round(mid, 2);
  assert m.status = 'playing' and m.round_index = 3, 'a stale advance must not skip a round';

  m := public.advance_round(mid, 3);
  assert m.status = 'done', 'advancing past the last round finishes the match';
  assert (select count(*) from public.round_views where answer is not null) = 3,
    'a finished match reveals every answer';
  assert (select count(distinct prompt) from public.round_views) = 3, 'no word is asked twice in a match';
  assert not exists (
    select 1 from public.round_views r, unnest(r.choices || r.prompt) t
    where t like 'unverified-%' or t like '미확인-%'
  ), 'unverified words never reach a round, as prompt or as choice';
end $$;

rollback;
