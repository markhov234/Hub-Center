-- 24 hand-checked words so the game is playable before the LLM generator exists.
-- Paste into the Supabase SQL editor once, after the migrations. Safe to re-run.

insert into public.decks (id, name, topic, level)
values ('5eed0000-0000-4000-8000-000000000001', 'Les bases · 기초', 'basics', 'beginner')
on conflict (id) do nothing;

insert into public.words (fr, ko, ko_romaja, en_gloss, topic, level, verified) values
  ('bonjour',     '안녕하세요', 'annyeonghaseyo', 'hello',     'basics', 'beginner', true),
  ('merci',       '감사합니다', 'gamsahamnida',   'thank you', 'basics', 'beginner', true),
  ('oui',         '네',         'ne',             'yes',       'basics', 'beginner', true),
  ('non',         '아니요',     'aniyo',          'no',        'basics', 'beginner', true),
  ('eau',         '물',         'mul',            'water',     'basics', 'beginner', true),
  ('riz',         '밥',         'bap',            'cooked rice', 'basics', 'beginner', true),
  ('pain',        '빵',         'ppang',          'bread',     'basics', 'beginner', true),
  ('pomme',       '사과',       'sagwa',          'apple',     'basics', 'beginner', true),
  ('lait',        '우유',       'uyu',            'milk',      'basics', 'beginner', true),
  ('café',        '커피',       'keopi',          'coffee',    'basics', 'beginner', true),
  ('thé',         '차',         'cha',            'tea',       'basics', 'beginner', true),
  ('chat',        '고양이',     'goyangi',        'cat',       'basics', 'beginner', true),
  ('chien',       '개',         'gae',            'dog',       'basics', 'beginner', true),
  ('maison',      '집',         'jip',            'house',     'basics', 'beginner', true),
  ('école',       '학교',       'hakgyo',         'school',    'basics', 'beginner', true),
  ('ami',         '친구',       'chingu',         'friend',    'basics', 'beginner', true),
  ('amour',       '사랑',       'sarang',         'love',      'basics', 'beginner', true),
  ('livre',       '책',         'chaek',          'book',      'basics', 'beginner', true),
  ('famille',     '가족',       'gajok',          'family',    'basics', 'beginner', true),
  ('mer',         '바다',       'bada',           'sea',       'basics', 'beginner', true),
  ('montagne',    '산',         'san',            'mountain',  'basics', 'beginner', true),
  ('nourriture',  '음식',       'eumsik',         'food',      'basics', 'beginner', true),
  ('aujourd''hui', '오늘',      'oneul',          'today',     'basics', 'beginner', true),
  ('demain',      '내일',       'naeil',          'tomorrow',  'basics', 'beginner', true)
on conflict (fr, ko) do nothing;

insert into public.deck_words (deck_id, word_id)
select '5eed0000-0000-4000-8000-000000000001', id from public.words where topic = 'basics'
on conflict do nothing;
