-- ══════════════════════════════════════════════════════════════
--  לומדים ביחד — סכימת בסיס הנתונים (Supabase / Postgres)
--  הרצה: Supabase Dashboard → SQL Editor → הדביקו והריצו.
--  כל טבלה מוגנת ב-RLS: כל משתמש רואה ומנהל רק את השורות שלו.
-- ══════════════════════════════════════════════════════════════

-- ── פרופיל הלומד/ת (שם + מין, לפנייה אישית) ──
create table if not exists profiles (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  name text,
  gender text default 'בן',      -- 'בן' | 'בת'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── שיחות "תסביר לי" (היסטוריה) ──
create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid references subjects on delete cascade,
  title text,
  messages jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── מקצועות ──
create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  color text default '#4A55C7',
  bg text default '#E4E8F3',
  exam_kind text,               -- 'מבחן מסכם' | 'מבדק'
  exam_date date,               -- תאריך המבחן המסכם
  exam_scope_text text,         -- מיקוד החומר של המבחן המסכם
  quiz_date date,               -- תאריך המבדק
  quiz_scope_text text,         -- מיקוד החומר של המבדק
  created_at timestamptz default now()
);
-- אם הטבלה כבר קיימת — מוסיף עמודות מבדק בלי לשבור כלום:
alter table subjects add column if not exists quiz_date date;
alter table subjects add column if not exists quiz_scope_text text;

-- ── נושאים (המערכת מזהה אותם מהחומר) ──
create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  name text not null,
  origin text default 'השנה',   -- 'השנה' | 'חזרה'
  in_exam boolean default false,
  created_at timestamptz default now()
);

-- ── חומרים שהועלו ──
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  topic_id uuid references topics on delete set null,
  title text,
  kind text default 'image',    -- 'image' | 'pdf' | 'text'
  storage_path text,            -- נתיב בבאקט 'materials'
  origin text default 'השנה',
  summary_md text,              -- הסיכום שנוצר
  content_hash text,            -- חתימת SHA-256 של הקובץ — לזיהוי כפילויות
  source_text text,             -- הטקסט המלא (למשל שיר בספרות) — להצגה נוחה
  created_at timestamptz default now()
);
-- אם הטבלה כבר קיימת מהרצה קודמת — מוסיף את העמודות בלי לשבור כלום:
alter table materials add column if not exists content_hash text;
alter table materials add column if not exists source_text text;

-- ── שאלות תרגול ──
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  topic_id uuid references topics on delete set null,
  material_id uuid references materials on delete set null,
  q text not null,
  choices jsonb not null,       -- ["...","...","...","..."]
  answer int not null,          -- אינדקס התשובה הנכונה
  difficulty text default 'בינוני',
  explain text,
  hint text,
  created_at timestamptz default now()
);

-- ── יומן תשובות (הבסיס למודל השליטה) ──
create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid references subjects on delete cascade,
  question_id uuid references questions on delete cascade,
  topic_id uuid references topics on delete set null,
  correct boolean not null,
  difficulty text default 'בינוני',
  created_at timestamptz default now()
);

-- ── כרטיסיות ──
create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  topic_id uuid references topics on delete set null,
  front text not null,
  back text not null,
  context text,                 -- הקשר קצר שמוצג לפני החשיפה (מאיזה שיר/נושא)
  created_at timestamptz default now()
);
alter table flashcards add column if not exists context text;

-- ── "לחיזוק" (עקומת למידה) ──
create table if not exists review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  kind text not null,           -- 'question' | 'flashcard'
  ref_id uuid not null,
  streak int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, kind, ref_id)
);

-- ── מבחנים שעברו ──
create table if not exists past_exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subject_id uuid not null references subjects on delete cascade,
  kind text,
  exam_date date,
  grade int,
  storage_path text,            -- צילום המבחן המתוקן
  analyzed boolean default false,
  created_at timestamptz default now()
);
alter table past_exams add column if not exists storage_path text;
alter table past_exams add column if not exists analyzed boolean default false;

-- ── RLS — כל משתמש רואה ומנהל רק את השורות שלו ──
-- (כתוב במפורש לכל טבלה כדי שירוץ חלק גם בעורך ה-SQL של Supabase)
alter table profiles     enable row level security;
alter table chats        enable row level security;
alter table subjects     enable row level security;
alter table topics       enable row level security;
alter table materials    enable row level security;
alter table questions    enable row level security;
alter table attempts     enable row level security;
alter table flashcards   enable row level security;
alter table review_items enable row level security;
alter table past_exams   enable row level security;

drop policy if exists own_all on profiles;
create policy own_all on profiles     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on chats;
create policy own_all on chats        for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on subjects;
create policy own_all on subjects     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on topics;
create policy own_all on topics       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on materials;
create policy own_all on materials    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on questions;
create policy own_all on questions    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on attempts;
create policy own_all on attempts     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on flashcards;
create policy own_all on flashcards   for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on review_items;
create policy own_all on review_items for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists own_all on past_exams;
create policy own_all on past_exams   for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── אחסון תמונות ──
insert into storage.buckets (id, name, public)
values ('materials','materials', false)
on conflict (id) do nothing;

drop policy if exists "materials own" on storage.objects;
create policy "materials own" on storage.objects
  for all to authenticated
  using (bucket_id = 'materials' and owner = auth.uid())
  with check (bucket_id = 'materials' and owner = auth.uid());
