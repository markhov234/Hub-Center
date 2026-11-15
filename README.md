# Hub

A small personal app center. One app so far: **Langue · 언어**, a live French ↔ Korean
quiz for two players, each on their own phone.

Expo (React Native + web) on the front, Supabase on the back. There is no server of our
own: match state is rows in Postgres, Supabase Realtime pushes row changes to both
phones, and the game rules are Postgres functions.

## First-time setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Point the app at it:
   ```bash
   cp .env.example .env.local
   ```
   Fill in both values from **Project Settings → API**.
3. Create the database (no Docker needed, this talks to the hosted project):
   ```bash
   npx supabase login
   npx supabase init
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```
4. Paste `supabase/seed.sql` into the Supabase **SQL editor** and run it. That gives you
   a 24-word starter deck.
5. Run it:
   ```bash
   npm start
   ```
   Scan the QR code with **Expo Go** on each phone, or press `w` for the browser.
6. Each of you creates an account in the app. **Then turn sign-ups off**
   (Authentication → Sign In / Providers → *Allow new users to sign up*). The app's URL
   and key are public by design, so until you do, anyone who finds them can register.

### Deck generator (optional)

Needs an Anthropic API key. Each generated deck costs a few cents.

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy generate-deck
```

Generated words are stored unverified and cannot appear in a match until one of you
approves them on the **Words** screen.

## Day to day

| | |
|---|---|
| `npm start` | dev server (Expo Go / web) |
| `npm run test:sql` | runs the migrations and the game-rules test on an in-memory Postgres |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |

## Where things are

| Path | What |
|---|---|
| `supabase/migrations/` | Schema, row-level security, and the game rules. **Start reading here.** |
| `supabase/tests/game_rules.sql` | Plays a whole match as two players plus an outsider and asserts the rules hold |
| `supabase/functions/generate-deck/` | Edge function: Claude → unverified words |
| `src/hooks/use-match.ts` | The realtime subscription and the calls that move a match forward |
| `src/app/` | Screens. `index.tsx` is the hub; adding an app is adding a route and a line there |

## How a match works

1. `create_match` makes a lobby and a 6-character code. `join_match` with that code adds
   the second player and deals round 1.
2. Each phone reads the live round through the `round_views` view, which hides the right
   answer until the round is over. The `rounds` table itself is unreadable by clients.
3. `submit_answer` scores you once (the primary key on `answers` makes it write-once)
   and tells you the right option.
4. When everyone has answered or the clock runs out, both phones call `advance_round`.
   A row lock plus an expected-round check means exactly one of those calls does anything.

## Known shortcuts

Search the code for `shortcut:` to find each one with its upgrade path.

- Any signed-in user can approve or delete words (fine for two owners).
- The session is stored unencrypted on the device, as Supabase documents for Expo.
- The countdown trusts the phone's clock for display; scoring never does.
