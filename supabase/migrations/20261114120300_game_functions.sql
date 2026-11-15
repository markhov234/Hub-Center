-- The game rules. Every write to a match goes through one of these functions.
-- All are security definer (they bypass RLS) and so each one checks the caller itself.

-- 6 characters, no 0/O/1/I/L so it can be read out loud across a room.
create function public.gen_match_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  loop
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
      into v_code
      from generate_series(1, 6);
    exit when not exists (select 1 from public.matches where code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Picks an unused verified word from the match's deck plus 3 distractors, shuffles them,
-- and stores the round. Internal: never callable by clients.
create function public.new_round(p_match_id uuid, p_idx int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deck    uuid;
  v_dir     text;
  v_word    public.words;
  v_correct text;
  v_choices text[];
begin
  select deck_id into v_deck from public.matches where id = p_match_id;

  v_dir := case when random() < 0.5 then 'fr_to_ko' else 'ko_to_fr' end;

  select w.* into v_word
  from public.words w
  join public.deck_words dw on dw.word_id = w.id
  where dw.deck_id = v_deck
    and w.verified
    and not exists (
      select 1 from public.rounds r where r.match_id = p_match_id and r.word_id = w.id
    )
  order by random()
  limit 1;

  if v_word.id is null then
    raise exception 'deck has no unused verified words left';
  end if;

  v_correct := case when v_dir = 'fr_to_ko' then v_word.ko else v_word.fr end;

  -- distinct + "<> v_correct" so two words sharing a translation can't produce a round
  -- with two identical (and so both "right") options
  select array_agg(x) into v_choices
  from (
    select x from (
      select distinct case when v_dir = 'fr_to_ko' then w.ko else w.fr end as x
      from public.words w
      join public.deck_words dw on dw.word_id = w.id
      where dw.deck_id = v_deck and w.verified
    ) d
    where x <> v_correct
    order by random()
    limit 3
  ) picked;

  if v_choices is null or array_length(v_choices, 1) < 3 then
    raise exception 'deck needs at least 4 verified words with distinct translations';
  end if;

  select array_agg(c order by random()) into v_choices
  from unnest(v_choices || v_correct) c;

  insert into public.rounds (match_id, idx, word_id, direction, prompt, choices, answer)
  values (
    p_match_id,
    p_idx,
    v_word.id,
    v_dir,
    case when v_dir = 'fr_to_ko' then v_word.fr else v_word.ko end,
    v_choices,
    array_position(v_choices, v_correct) - 1   -- array_position is 1-based, answer is 0-based
  );
end;
$$;

create function public.create_match(
  p_deck_id uuid,
  p_round_count int default 10,
  p_round_seconds int default 15
)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m     public.matches;
  v_words int;
  v_fr    int;
  v_ko    int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Fail now, in the lobby, rather than halfway through the match. A round needs 3 wrong
  -- options that differ from the right one, in whichever language it is asked, so the
  -- deck needs 4 distinct texts on each side, not just 4 words.
  select count(*), count(distinct w.fr), count(distinct w.ko)
    into v_words, v_fr, v_ko
    from public.deck_words dw
    join public.words w on w.id = dw.word_id
   where dw.deck_id = p_deck_id and w.verified;

  if v_words < p_round_count then
    raise exception 'deck does not have enough verified words for % rounds', p_round_count;
  end if;
  if least(v_fr, v_ko) < 4 then
    raise exception 'deck needs at least 4 verified words with distinct translations';
  end if;

  insert into public.matches (code, deck_id, host_id, round_count, round_seconds)
  values (public.gen_match_code(), p_deck_id, auth.uid(), p_round_count, p_round_seconds)
  returning * into v_m;

  insert into public.match_players (match_id, user_id) values (v_m.id, auth.uid());
  return v_m;
end;
$$;

-- Joining as the second player starts the match.
create function public.join_match(p_code text)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.matches;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- row lock: two people joining at once must not both start round 1
  select * into v_m from public.matches where code = upper(trim(p_code)) for update;

  if v_m.id is null then
    raise exception 'no match with that code';
  end if;

  if public.is_match_player(v_m.id) then
    return v_m;   -- rejoining your own match is a no-op
  end if;

  if v_m.status <> 'lobby' then
    raise exception 'match already started';
  end if;

  insert into public.match_players (match_id, user_id) values (v_m.id, auth.uid());

  perform public.new_round(v_m.id, 1);

  update public.matches
     set status = 'playing', round_index = 1, round_started_at = now()
   where id = v_m.id
  returning * into v_m;

  return v_m;
end;
$$;

-- Returns the index of the right option, so the client can show it the moment you have
-- locked in your own answer. Answering twice changes nothing and scores nothing: the
-- primary key on answers is what makes this write-once.
create function public.submit_answer(p_round_id uuid, p_choice int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.rounds;
  v_m public.matches;
begin
  select * into v_r from public.rounds where id = p_round_id;
  if v_r.id is null or not public.is_match_player(v_r.match_id) then
    raise exception 'not a player in this match';
  end if;

  select * into v_m from public.matches where id = v_r.match_id;

  if v_m.status <> 'playing' or v_m.round_index <> v_r.idx then
    raise exception 'round is not live';
  end if;

  -- server clock only; 2s of grace covers the network hop from a phone
  if now() > v_m.round_started_at + make_interval(secs => v_m.round_seconds + 2) then
    raise exception 'too late';
  end if;

  insert into public.answers (round_id, user_id, choice, correct)
  values (p_round_id, auth.uid(), p_choice, p_choice = v_r.answer)
  on conflict (round_id, user_id) do nothing;

  -- FOUND is false when the row was already there, i.e. this is a repeat answer
  if found and p_choice = v_r.answer then
    update public.match_players
       set score = score + 1
     where match_id = v_r.match_id and user_id = auth.uid();
  end if;

  return v_r.answer;
end;
$$;

-- Both phones call this when the round ends, often at the same instant. The row lock
-- serialises them and the expected-index check turns the loser into a no-op, so a round
-- can never be skipped. This pair of lines is what replaces a game server.
create function public.advance_round(p_match_id uuid, p_expected_index int)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.matches;
begin
  if not public.is_match_player(p_match_id) then
    raise exception 'not a player in this match';
  end if;

  select * into v_m from public.matches where id = p_match_id for update;

  if v_m.status <> 'playing' or v_m.round_index <> p_expected_index then
    return v_m;
  end if;

  -- only move on once everyone has answered or the clock has run out
  if (
       select count(*) from public.answers a
       join public.rounds r on r.id = a.round_id
       where r.match_id = p_match_id and r.idx = v_m.round_index
     ) < (select count(*) from public.match_players where match_id = p_match_id)
     and now() < v_m.round_started_at + make_interval(secs => v_m.round_seconds)
  then
    return v_m;
  end if;

  if v_m.round_index >= v_m.round_count then
    update public.matches
       set status = 'done'
     where id = p_match_id
    returning * into v_m;
  else
    perform public.new_round(p_match_id, v_m.round_index + 1);
    update public.matches
       set round_index = round_index + 1, round_started_at = now()
     where id = p_match_id
    returning * into v_m;
  end if;

  return v_m;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default. Lock everything down, then open only
-- the four client-facing RPCs (and the membership check the RLS policies call).
revoke execute on function public.gen_match_code()                 from public, anon, authenticated;
revoke execute on function public.new_round(uuid, int)             from public, anon, authenticated;
revoke execute on function public.handle_new_user()                from public, anon, authenticated;
revoke execute on function public.is_match_player(uuid)            from public, anon;
revoke execute on function public.create_match(uuid, int, int)     from public, anon;
revoke execute on function public.join_match(text)                 from public, anon;
revoke execute on function public.submit_answer(uuid, int)         from public, anon;
revoke execute on function public.advance_round(uuid, int)         from public, anon;

grant execute on function public.is_match_player(uuid)         to authenticated;
grant execute on function public.create_match(uuid, int, int)  to authenticated;
grant execute on function public.join_match(text)              to authenticated;
grant execute on function public.submit_answer(uuid, int)      to authenticated;
grant execute on function public.advance_round(uuid, int)      to authenticated;
