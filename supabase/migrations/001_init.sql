-- ============================================================
-- Cogent Referral Engine — Database Schema + Seed Data
-- ============================================================
-- Run this in your Supabase SQL Editor after creating the project.

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- -------------------------------------------------------
-- profiles table (linked to Supabase auth.users)
-- -------------------------------------------------------
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  full_name text not null,
  role text not null default 'employee' check (role in ('employee', 'admin')),
  created_at timestamptz not null default now()
);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'employee'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------
-- jobs table (open engineering roles)
-- -------------------------------------------------------
create table public.jobs (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  department text not null default 'Engineering',
  priority text not null check (priority in ('critical', 'high', 'medium')),
  openings int not null default 1,
  filled int not null default 0,
  description text,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- connections table (parsed LinkedIn CSV rows)
-- -------------------------------------------------------
create table public.connections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  first_name text not null,
  last_name text not null,
  headline text,
  company text,
  linkedin_url text,
  uploaded_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- referrals table
-- -------------------------------------------------------
create table public.referrals (
  id uuid primary key default uuid_generate_v4(),
  connection_id uuid references public.connections(id) on delete cascade not null,
  job_id uuid references public.jobs(id) on delete cascade not null,
  referred_by uuid references public.profiles(id) on delete cascade not null,
  fit_score float not null default 0 check (fit_score >= 0 and fit_score <= 1),
  composite_score float not null default 0 check (composite_score >= 0 and composite_score <= 1),
  reasoning text,
  status text not null default 'suggested' check (
    status in ('suggested', 'submitted', 'contacted', 'interviewing', 'hired', 'passed')
  ),
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------
-- Row Level Security (RLS)
-- -------------------------------------------------------

-- profiles: users can read their own profile; admins can read all
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Admins can view all profiles"
  on public.profiles for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- jobs: readable by all authenticated users
alter table public.jobs enable row level security;

create policy "Authenticated users can view jobs"
  on public.jobs for select
  using (auth.uid() is not null);

-- connections: users see their own
alter table public.connections enable row level security;

create policy "Users can view own connections"
  on public.connections for select
  using (auth.uid() = user_id);

create policy "Users can insert own connections"
  on public.connections for insert
  with check (auth.uid() = user_id);

-- referrals: employees see their own; admins see all
alter table public.referrals enable row level security;

create policy "Users can view own referrals"
  on public.referrals for select
  using (auth.uid() = referred_by);

create policy "Admins can view all referrals"
  on public.referrals for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

create policy "Users can insert own referrals"
  on public.referrals for insert
  with check (auth.uid() = referred_by);

create policy "Users can update own referrals"
  on public.referrals for update
  using (auth.uid() = referred_by);

create policy "Admins can update all referrals"
  on public.referrals for update
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- -------------------------------------------------------
-- Seed data: 5 open engineering roles
-- -------------------------------------------------------
insert into public.jobs (title, department, priority, openings, filled, description, keywords) values
(
  'Senior Backend Engineer',
  'Engineering',
  'critical',
  4, 1,
  'Build and scale our core platform services. Work with distributed systems, cloud infrastructure, and high-throughput APIs.',
  array['Python', 'distributed systems', 'cloud', 'APIs', 'microservices']
),
(
  'ML/AI Engineer',
  'Engineering',
  'critical',
  5, 1,
  'Design and train production ML models. Work on LLM integration, ML infrastructure, and deep learning research applied to product.',
  array['PyTorch', 'TensorFlow', 'LLMs', 'ML infrastructure', 'deep learning']
),
(
  'Full Stack Engineer',
  'Engineering',
  'high',
  6, 2,
  'Own features end-to-end from database to UI. Strong product sense and experience with modern web frameworks.',
  array['React', 'TypeScript', 'Node.js', 'Next.js', 'product sense']
),
(
  'Platform / Infra Engineer',
  'Engineering',
  'high',
  3, 0,
  'Build the developer platform and infrastructure. Focus on reliability, CI/CD, observability, and developer experience.',
  array['Kubernetes', 'CI/CD', 'Terraform', 'observability', 'DevEx']
),
(
  'Engineering Manager',
  'Engineering',
  'medium',
  2, 0,
  'Lead a team of engineers. Drive delivery, mentorship, and culture at a fast-moving Series A startup.',
  array['People management', 'delivery', 'mentorship', 'startup experience']
);
