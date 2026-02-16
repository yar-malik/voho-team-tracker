# Voho Tracker

Voho Tracker is a DB-first time tracking platform used to organize daily life and work, measure total hours worked, and manage team productivity in one place.

It is designed for:
- Personal time tracking and life organization
- Team time tracking across members
- Clear visibility into who is working, for how long, and on what

## Product Scope

Voho Tracker combines:
- Live timer and calendar-based time entries
- Project-based work tracking with color-coded timelines
- Team dashboards and member cards with daily totals
- KPI management for team members
- Pomodoro support for focused work sessions

It also supports company-style usage through:
- Settings and user profile management
- Multi-member team workflows
- A foundation for insights and company-level controls

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Required Environment

Copy `.env.local.example` to `.env.local` and set:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Optional:

```bash
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
KPI_SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/<sheet-id>/export?format=csv&gid=<gid>
KPI_SHEET_URL=https://docs.google.com/spreadsheets/d/<sheet-id>/edit?usp=sharing
BOOTSTRAP_ADMIN_SECRET=your-bootstrap-secret
```

## Database Setup

Run `supabase/schema.sql` in Supabase SQL editor, then run migrations with Supabase CLI.

## Data Model

- `public.members`: member profiles, identity, and role metadata
- `public.projects`: project metadata, type, and color
- `public.time_entries`: all tracked time entries (running + completed)
- `public.daily_member_stats`: daily aggregated totals by member
- `public.member_kpis`: KPI rows by member
- `public.project_aliases`: duplicate-project merge mapping
- `public.sync_events`: operational sync/event logging
- `public.api_quota_locks`: API lock/cooldown state (if enabled)

## Architecture

- Database-first reads and writes (Supabase as system of record)
- API routes in `src/app/api/*`
- Live event-driven UI updates for timer + calendar
- Single shared platform shell for navigation and global timer state

## Security Notes

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Do not commit `.env.local`.
- Rotate bootstrap/admin secrets before production or open-source release.
