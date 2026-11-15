import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type Match = {
  id: string;
  code: string;
  status: 'lobby' | 'playing' | 'done';
  round_index: number;
  round_count: number;
  round_seconds: number;
  round_started_at: string | null;
};

export type Player = { user_id: string; score: number; profiles: { display_name: string } | null };

export type Round = {
  id: string;
  idx: number;
  direction: 'fr_to_ko' | 'ko_to_fr';
  prompt: string;
  choices: string[];
};

/** What you picked and what was right, once the server has taken your answer. */
export type Verdict = { roundId: string; choice: number; answer: number };

// How long you get to look at the right answer before your phone asks for the next round.
const REVEAL_MS = 1500;

// Safe to call from both phones at once, early, late or twice: the server ignores every
// call except the first valid one for a given round. A failure is shown rather than
// dropped, because the caller retries every second and would otherwise spin silently.
async function advanceRound(
  matchId: string,
  roundIndex: number,
  setMatch: (match: Match) => void,
  setError: (message: string | null) => void
) {
  const { data, error } = await supabase.rpc('advance_round', {
    p_match_id: matchId,
    p_expected_index: roundIndex,
  });
  if (error) return setError(error.message);
  setError(null);
  if (data) setMatch(data as Match);
}

/**
 * Everything the match screen needs. There is no game server: this subscribes to the
 * match's rows over Realtime and nudges the match forward through RPCs.
 */
export function useMatch(matchId: string) {
  const [match, setMatch] = useState<Match | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [round, setRound] = useState<Round | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const [m, p] = await Promise.all([
        supabase.from('matches').select('*').eq('id', matchId).single(),
        supabase
          .from('match_players')
          .select('user_id, score, profiles(display_name)')
          .eq('match_id', matchId)
          .order('user_id'),
      ]);
      if (m.error || p.error) return setError((m.error ?? p.error)!.message);
      setError(null);
      setMatch(m.data as Match);
      setPlayers(p.data as unknown as Player[]);
    };

    const channel = supabase
      .channel(`match:${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (change) => setMatch(change.new as Match)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_players', filter: `match_id=eq.${matchId}` },
        load
      )
      // SUBSCRIBED fires on the first connect and again after every reconnect, so this
      // one call is both the initial load and the catch-up for anything missed offline.
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') load();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId]);

  const roundIndex = match?.status === 'playing' ? match.round_index : 0;

  useEffect(() => {
    if (!roundIndex) return;
    let stale = false;
    supabase
      .from('round_views')
      .select('id, idx, direction, prompt, choices')
      .eq('match_id', matchId)
      .eq('idx', roundIndex)
      .single()
      .then(({ data, error }) => {
        if (stale) return;
        if (error) setError(error.message);
        else setRound(data as Round);
      });
    return () => {
      stale = true;
    };
  }, [matchId, roundIndex]);

  const deadline =
    roundIndex && match?.round_started_at
      ? new Date(match.round_started_at).getTime() + match.round_seconds * 1000
      : null;

  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => {
      setNow(Date.now());
      // shortcut: the deadline is the server's timestamp read against this phone's clock.
      // Ticking every second means a phone running fast just gets refused and retries, and
      // one running slow is overtaken by the other phone. Sync a clock offset from the
      // server if the countdown ever looks visibly wrong.
      if (Date.now() >= deadline) {
        advanceRound(matchId, roundIndex, setMatch, setError);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [matchId, roundIndex, deadline]);

  async function answer(choice: number) {
    if (!round || submitting || verdict?.roundId === round.id) return;
    const { id, idx } = round;
    setSubmitting(true);
    const { data, error } = await supabase.rpc('submit_answer', { p_round_id: id, p_choice: choice });
    setSubmitting(false);
    // A failure here means the round ended under you or the tap never arrived. Either
    // way the screen is still correct, and tapping again is safe (answers are write-once).
    if (error) return;
    setVerdict({ roundId: id, choice, answer: data as number });
    setTimeout(() => {
      advanceRound(matchId, idx, setMatch, setError);
    }, REVEAL_MS);
  }

  const live = round && round.idx === roundIndex ? round : null;

  return {
    match,
    players,
    round: live,
    verdict: live && verdict?.roundId === live.id ? verdict : null,
    secondsLeft: deadline ? Math.max(Math.ceil((deadline - now) / 1000), 0) : null,
    submitting,
    error,
    answer,
  };
}
