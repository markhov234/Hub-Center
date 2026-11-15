// Asks Claude for a French/Korean vocabulary deck and stores it UNVERIFIED.
// Nothing generated here can appear in a match until one of you approves it on the
// Words screen: a model can get formality, nuance or romanization wrong.
//
// Runs on Supabase Edge Functions (Deno). Needs the ANTHROPIC_API_KEY secret:
//   npx supabase secrets set ANTHROPIC_API_KEY=...
import Anthropic from 'npm:@anthropic-ai/sdk@^1.8.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@^1.8.0/helpers/zod';
import { createClient } from 'npm:@supabase/supabase-js@^2';
import { z } from 'npm:zod@^4';

// The web build calls this from a browser, so it has to answer CORS preflights.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const Input = z.object({
  topic: z.string().trim().min(2).max(60),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  count: z.number().int().min(4).max(50),
});

const Deck = z.object({
  words: z.array(
    z.object({ fr: z.string(), ko: z.string(), ko_romaja: z.string(), en_gloss: z.string() })
  ),
});

const SYSTEM = `You write vocabulary decks for a couple learning each other's languages: a French speaker learning Korean and a Korean speaker learning French.

Return exactly the requested number of distinct words or short set phrases on the given topic, at the given level.

For each entry:
- fr: the French, lowercase unless it is a proper noun, nouns without an article.
- ko: the natural everyday Korean equivalent in Hangul. Verbs and adjectives in dictionary form; set phrases in the polite style they are normally taught in.
- ko_romaja: the Revised Romanization of ko.
- en_gloss: a short English gloss.

The entries are used as each other's wrong answers in a multiple-choice quiz, so every fr must be different from every other fr, every ko different from every other ko, and no two entries may be synonyms of each other. Prefer words with one clear translation over ambiguous ones.`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Service-role client: bypasses RLS, which is how this function is allowed to insert words.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Every call costs API money, so it must come from a signed-in user. The anon key is
  // itself a valid JWT but resolves to no user, so it is turned away here.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return json({ error: 'Sign in first.' }, 401);

  const input = Input.safeParse(await req.json().catch(() => null));
  if (!input.success) {
    return json({ error: 'Need a topic (2-60 characters), a level, and a count from 4 to 50.' }, 400);
  }
  const { topic, level, count } = input.data;

  let generated: z.infer<typeof Deck> | null;
  try {
    const response = await new Anthropic().messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Topic: ${topic}\nLevel: ${level}\nNumber of entries: ${count}` }],
      output_config: { format: zodOutputFormat(Deck) },
    });
    generated = response.stop_reason === 'refusal' ? null : response.parsed_output;
  } catch (error) {
    if (error instanceof Anthropic.APIError) return json({ error: `Claude API: ${error.message}` }, 502);
    throw error;
  }
  if (!generated) return json({ error: 'No usable deck came back. Try another topic.' }, 502);

  // Keyed by the same pair as the table's unique constraint, which also drops any
  // duplicates within this batch.
  const words = new Map(
    generated.words
      .map((w) => ({
        fr: w.fr.trim(),
        ko: w.ko.trim(),
        ko_romaja: w.ko_romaja.trim(),
        en_gloss: w.en_gloss.trim(),
        topic,
        level,
      }))
      .filter((w) => w.fr && w.ko)
      .map((w) => [`${w.fr}|${w.ko}`, w])
  );
  if (words.size < 4) return json({ error: 'Too few words came back. Try again.' }, 502);

  // ignoreDuplicates: a pair that already exists is left exactly as it is, so a word one
  // of you has already verified is never overwritten by fresh model output.
  const inserted = await admin
    .from('words')
    .upsert([...words.values()], { onConflict: 'fr,ko', ignoreDuplicates: true });
  if (inserted.error) return json({ error: inserted.error.message }, 500);

  // Read the ids back so pre-existing words join the new deck too.
  const rows = await admin
    .from('words')
    .select('id, fr, ko')
    .in('fr', [...words.values()].map((w) => w.fr));
  if (rows.error) return json({ error: rows.error.message }, 500);
  const wordIds = rows.data.filter((r) => words.has(`${r.fr}|${r.ko}`)).map((r) => r.id);

  const deck = await admin
    .from('decks')
    .insert({ name: `${topic} · ${level}`, topic, level, created_by: auth.user.id })
    .select('id')
    .single();
  if (deck.error) return json({ error: deck.error.message }, 500);

  const linked = await admin
    .from('deck_words')
    .insert(wordIds.map((word_id) => ({ deck_id: deck.data.id, word_id })));
  if (linked.error) return json({ error: linked.error.message }, 500);

  return json({ deck_id: deck.data.id, words: wordIds.length });
});
