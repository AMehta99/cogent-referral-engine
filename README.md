# Cogent Referral Engine

A web app that makes it effortless for Cogent engineers to refer people from their LinkedIn network by removing the friction of figuring out who to refer and to which role.

## Tech Stack

- **Next.js 14** (App Router)
- **Supabase** (Auth + Postgres)
- **Tailwind CSS**
- **Claude API** (claude-sonnet-4-20250514) for AI matching
- **Vercel** for deployment

## Setup Guide

### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to the **SQL Editor** and run the migration file: `supabase/migrations/001_init.sql`
3. This creates all tables, RLS policies, and seeds 5 open engineering roles
4. Copy your **Project URL** and **anon key** from Project Settings > API

### 2. Environment Variables

Copy `.env.local` and fill in your values:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
ANTHROPIC_API_KEY=your-anthropic-api-key
```

- Get your Anthropic API key from [console.anthropic.com](https://console.anthropic.com)

### 3. Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Review TODOs

Before deploying, review these customization points:

- **`/lib/matching.ts`** — AI matching prompt and fit_score threshold (default 0.5)
- **`/lib/scoring.ts`** — Composite scoring weights (40/25/20/15)
- **`/app/api/match/route.ts`** — Claude API system prompt

### 5. Deploy to Vercel

1. Push to GitHub
2. Connect the repo to [Vercel](https://vercel.com)
3. Add all three environment variables in Vercel project settings
4. Deploy

### 6. Create an Admin User

After signing up, manually update your profile role in Supabase:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'your-email@cogent.com';
```

## Architecture

```
/app
  /login/page.tsx          ← Supabase email/password auth
  /dashboard/page.tsx      ← Employee view: upload CSV, review matches, submit referrals
  /admin/page.tsx          ← Admin view: all referrals, filters, status management
  /api/match/route.ts      ← Claude API matching endpoint
  /api/score/route.ts      ← Composite scoring endpoint
/components
  CSVUploader.tsx           ← Drag-and-drop CSV upload
  MatchCard.tsx             ← Individual match result card
  ReferralTable.tsx         ← Sortable/filterable referral table
  ScoreBadge.tsx            ← Score visualization bar
  StatusDropdown.tsx        ← Referral status selector
  PriorityBadge.tsx         ← Job priority badge
/lib
  supabase.ts              ← Supabase client
  types.ts                 ← TypeScript types
  matching.ts              ← AI matching logic
  scoring.ts               ← Composite scoring algorithm
  csv-parser.ts            ← LinkedIn CSV parser
/supabase
  /migrations/001_init.sql ← Full schema + RLS + seed data
```

## Scoring Algorithm

```
composite_score = fit_score * 0.40 + priority_score * 0.25 + headcount_gap * 0.20 + referral_overlap * 0.15
```

- **fit_score** (40%): AI-determined match quality
- **priority_score** (25%): critical=1.0, high=0.7, medium=0.4
- **headcount_gap** (20%): (openings - filled) / max_openings
- **referral_overlap** (15%): min(N referrers / 3, 1.0)
