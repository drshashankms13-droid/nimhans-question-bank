-- ============================================================
-- NIMHANS Question Bank — Supabase database setup
-- Run this once in Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Table that stores which questions each user has checked off.
--    One row = one checked question, for one user, for one paper.
--    Unchecking a question deletes its row (handled by the app).
create table if not exists public.checklist_progress (
  user_id     uuid not null references auth.users(id) on delete cascade,
  paper       text not null,              -- 'p1', 'p2', or 'p3'
  uid         text not null,              -- the question's unique id, e.g. "2020-06-S1-critical"
  updated_at  timestamptz not null default now(),
  primary key (user_id, paper, uid)
);

-- 2. Turn on Row Level Security so users can only ever see or change
--    their own rows — nobody can read or edit anyone else's progress.
alter table public.checklist_progress enable row level security;

-- 3. Policies: a user may select/insert/update/delete only rows
--    where user_id matches their own logged-in id.
create policy "Users can view their own progress"
  on public.checklist_progress
  for select
  using (auth.uid() = user_id);

create policy "Users can insert their own progress"
  on public.checklist_progress
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own progress"
  on public.checklist_progress
  for update
  using (auth.uid() = user_id);

create policy "Users can delete their own progress"
  on public.checklist_progress
  for delete
  using (auth.uid() = user_id);

-- 4. Helpful index for fast lookups when the app loads a user's
--    progress for a specific paper.
create index if not exists checklist_progress_user_paper_idx
  on public.checklist_progress (user_id, paper);
