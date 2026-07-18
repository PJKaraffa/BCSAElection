# BCSA Anonymous Voting System

## Setup
1. Create a Supabase project.
2. Run `schema.sql` in the Supabase SQL Editor.
3. Create the administrator in Supabase Authentication.
4. Run the administrator insert shown at the bottom of `schema.sql`.
5. Put the Supabase Project URL and anon key into `supabase-config.js`.
6. Upload all web files to GitHub Pages.
7. Open `admin.html`, create the election, import member IDs, and add candidates.

## Eligible voter CSV
```csv
member_id
10001
10002
10003
```

## Privacy design
- Plain member IDs are never stored; only SHA-256 hashes are saved.
- `ballots` and `ballot_selections` contain no member ID or voter foreign key.
- A temporary verification token is consumed when the ballot is submitted.
- Administrators can see turnout and totals, but cannot query which voter selected which candidate.

## Important operational safeguard
Do not add member IDs, names, emails, IP addresses, or user-agent data to ballot records. Avoid exposing detailed submission timestamps in routine exports because timing correlation can weaken practical anonymity in small elections.
