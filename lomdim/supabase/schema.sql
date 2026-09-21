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
  exam_date date,
  exam_scope_text text,         -- מיקוד החומר בטקסט חופשי
  created_at timestamptz default now()
);

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
  created_at timestamptz default now()
);

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

-- ── RLS ──
do $$
declare t text;
begin
  foreach t in array array['profiles','chats','subjects','topics','materials','questions','attempts','flashcards','review_items','past_exams']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($p$
      drop policy if exists own_all on %1$I;
      create policy own_all on %1$I
        for all using (user_id = auth.uid()) with check (user_id = auth.uid());
    $p$, t);
  end loop;
end $$;

-- ── אחסון תמונות ──
insert into storage.buckets (id, name, public)
values ('materials','materials', false)
on conflict (id) do nothing;

drop policy if exists "materials own" on storage.objects;
create policy "materials own" on storage.objects
  for all to authenticated
  using (bucket_id = 'materials' and owner = auth.uid())
  with check (bucket_id = 'materials' and owner = auth.uid());
