# Beyond Syllabus

Getting started

1. Install dependencies

```bash
npm install
```

Create a `.env` file with your Supabase project URL, publishable key, and server-side secret key:

```env
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="your-publishable-key"
SUPABASE_SECRET_KEY="your-secret-key"
OPENAI_API_KEY="your-openai-api-key"
# Optional: defaults to gpt-4o-mini
OPENAI_MODEL="gpt-4o-mini"
```

Use the publishable (or legacy anon) key for browser authentication. Never expose the secret/service-role key in a `NEXT_PUBLIC_` variable or browser code. The home page reads all rows from the `test data` table and renders its columns automatically.

The syllabus analysis route uses OpenAI's API. Create an API key in the
[OpenAI dashboard](https://platform.openai.com/api-keys) and keep it in the
server-side `OPENAI_API_KEY` environment variable. Do not prefix it with
`NEXT_PUBLIC_` or expose it in browser code.

Google sign-in redirects to `/auth/callback`. In Supabase Authentication → URL Configuration, allow both:

- `https://your-deployed-domain/auth/callback`
- `http://localhost:3000/auth/callback`

In Google Cloud, the OAuth client's authorized redirect URI must be the callback URL shown in Supabase's Google provider settings (usually `https://<project-ref>.supabase.co/auth/v1/callback`).

The home page lets signed-in users search for a course, select a specific
semester/instructor offering, upload a syllabus PDF, review generated skills
and resume bullets in separate tabs, and save only the items they select. The
PDF is analyzed on the server and stored in the private `syllabi` storage bucket.
For an offering that already has a syllabus record, no additional PDF or
`syllabi` row is created. Every successful upload links the signed-in user to
that offering in `user_courses`. The response is limited to three skill
categories, four skills per category, and five resume bullets. Upload a PDF
syllabus up to 4 MB.
Selected skills are stored in
`course_skills`. Each selected skill and resume bullet is also stored as its
own `ai_generations` row, so `votes.generation_id` can refer to an individual
item. Apply
`supabase/migrations/20261018194500_make_ai_items_individually_votable.sql`
and `supabase/migrations/20261019120000_create_private_syllabi_bucket.sql` in
the Supabase SQL Editor before using the save and upload features. The Course
skills page displays `course_skills` and its community vote totals. Users must
sign in and have a completed `user_courses` record for a course to vote. Apply
`supabase/migrations/20261019125000_add_course_skill_votes.sql` in the Supabase
SQL Editor to enable course skill voting.

2. Start development server

```bash
npm run dev
```

3. Build for production

```bash
npm run build
npm run start
```

## Scrape Columbia Bulletins

The scraper discovers department pages, reads the course catalog and section
tables from each page, and maps them into the `departments`, `courses`,
`course_catalog_versions`, `course_offerings`, `offering_sections`, and
`professors` tables. Each course/term is stored as an offering; its section,
call number, schedule, and location are stored in `offering_sections`. The
Bulletin HTML includes content hidden behind its tabs, so the scraper does not
need a browser to open each accordion. It supports Columbia College and Columbia
Engineering.

Run one department first to preview the extracted records:

```bash
npm run scrape:bulletin -- --department anthropology
```

Preview Columbia Engineering departments:

```bash
npm run scrape:engineering
npm run scrape:engineering -- --department computer-science
```

Add `--write` to save the records, or omit `--department` to collect all
departments in the selected school:

```bash
npm run scrape:bulletin -- --department anthropology --write
npm run scrape:bulletin -- --write
npm run scrape:engineering -- --write
```

The script reads `SUPABASE_URL` (or `NEXT_SUPABASE_URL`) and
`SUPABASE_SECRET_KEY` from `.env`. Use the server-side secret key only in this
local script; never expose it through a `NEXT_PUBLIC_` variable. A department's
database code is derived from its Bulletin URL slug; Engineering codes use the
`ENG_` prefix to avoid conflicting with College department codes. The supplied
schema has one department per course and a globally unique course code, so a
cross-listed course is associated with the first department where it is saved.
Existing course ownership is preserved during later scrapes. Enrollment figures
are not saved because the provided `course_offerings` table has no enrollment
columns. Professor records are deduplicated by normalized name. Professor UUIDs
from Bulletin instructor cells, including co-instructors, are passed to
`get_or_create_offering()`. Explicit `Topic:` labels are passed as the topic
title so the RPC can keep distinct topic offerings separate. The RPC handles
offering identity, section matching, and preservation of linked records.

Before using `--write`, apply the offering identity migration and create the
`get_or_create_offering()` RPC, then grant it to `service_role` as described in
the database setup. The scraper calls this RPC once per section and does not
write directly to `course_offerings` or `offering_sections`.

Files added

- `package.json` — project metadata and scripts
- `next.config.js` — Next.js config
- `src/app` — App Router entry (layout and page)
- `src/app/globals.css` — global styles
- `.gitignore`
