This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Toggl Setup

1. Copy `.env.local.example` to `.env.local`.
2. Add each teammate's personal Toggl API token in the JSON array.

Example:

```bash
TOGGL_TEAM='[
  {"name": "Alice", "token": "your-token-here"},
  {"name": "Bob", "token": "your-token-here"}
]'
```

Restart the dev server after editing `.env.local`.

## Supabase Setup (Recommended)

This app can persist cached snapshots in Supabase so cached data survives restarts and can be shared across users.

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Add these env vars to `.env.local` and your deployment platform:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

4. Restart the app.

Notes:
- If Supabase env vars are missing, the app falls back to in-memory cache.
- Service role key is server-only and must never be exposed to the browser.
- Cached snapshots are stored in `public.cache_snapshots`.
- Historical sync data is also stored for analysis (see tables below).

## AI Setup (Optional)

To enable automatic AI analysis in member profile sections, add:

```bash
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_MODEL` is optional. If omitted, the app defaults to `gpt-4.1-mini`.

## KPI Sheet Setup (Optional)

You can override member KPIs from a Google Sheet CSV (for example, only for specific teammates) while auto-generating KPIs for everyone else.

1. In Google Sheets, use **File -> Share -> Publish to web** (CSV) or use an export URL.
2. Add to env:

```bash
KPI_SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/<sheet-id>/export?format=csv&gid=<gid>
```

Or provide the normal sheet link and the app will auto-convert it:

```bash
KPI_SHEET_URL=https://docs.google.com/spreadsheets/d/<sheet-id>/edit?usp=sharing
```

CSV requirements:
- Include a member column named `member`, `name`, or `teammate`.
- Each other column is treated as a KPI (`column name` = KPI label, cell value = KPI value).
- Rows only for Abdullah/Hammaad/Rehman are fine; others will use automatic KPIs.

## Historical Data Stored

When you click **Refresh view**, the app now persists historical records to Supabase:

- `public.members`: known teammate identities.
- `public.projects`: project metadata (`workspace_id`, `project_id`, project name).
- `public.time_entries`: normalized Toggl entries (description, start/stop, duration, tags, raw payload).
- `public.daily_member_stats`: per-day rollups per member (total seconds, entry count).
- `public.sync_events`: ingestion/sync audit log (success/failure, scope, requested date).

This gives you a solid base for historical charts and deeper analysis.

## Features

- Daily summary per task description.
- Teammate search with saved filters stored in local storage.
- Team overview mode for the whole group.
- Light server-side caching with basic rate-limit handling.

## Notes

- Tokens are read on the server only and never sent to the browser.
- The dashboard queries Toggl's API for the selected teammate and date.
- Project-name API fan-out is disabled by default to protect Toggl quota.  
  Set `TOGGL_PROJECT_LOOKUPS=1` only if you explicitly want live project-detail lookups from Toggl.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
