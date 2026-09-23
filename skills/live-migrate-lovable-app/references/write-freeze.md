# Lovable (Supabase) Write Freeze

Rehearse the whole sequence in phase 2, including the undo. Hand each SQL block to the user to run; never ask for database credentials.

## 1. Capture the before-state (save the output in the state file)

```sql
-- Table privileges for the API roles
select grantee, table_schema, table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
group by 1, 2, 3 order by 3, 1;

-- Active scheduled jobs
select jobid, jobname, schedule from cron.job where active;

-- Writing functions that bypass table privileges
select p.proname from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.prosecdef;
```

If `cron` does not exist, there are no pg_cron jobs. For each `SECURITY DEFINER` function, decide with the user whether it writes and whether to `revoke execute ... from anon, authenticated` during the freeze. Some are read helpers used by RLS policies; revoking those breaks reads, which is acceptable during maintenance but must be undone.

## 2. Freeze

```sql
begin;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated, service_role;

create policy staticbot_freeze_objects_insert on storage.objects as restrictive for insert to anon, authenticated with check (false);
create policy staticbot_freeze_objects_update on storage.objects as restrictive for update to anon, authenticated using (false);
create policy staticbot_freeze_objects_delete on storage.objects as restrictive for delete to anon, authenticated using (false);

update cron.job set active = false where active;
commit;
```

`SELECT` stays granted, so exports and the Staticbot export function keep working. Remaining writers the SQL cannot stop: the auth service (sign-ups, password and profile changes), service-role storage uploads from edge functions, and anything connecting as `postgres`. List them in the writer table with their own control or an accepted-risk note.

## 3. Probe (expected: failure)

Generate this for the user, filled with the project URL and publishable/anon key from the repository's env file (public values). The user supplies `ACCESS_TOKEN` of a signed-in **non-admin** test account from their browser session and runs it themselves:

```bash
curl -s -X PATCH "$SUPABASE_URL/rest/v1/<table>?<owner_column>=eq.<test_user_id>" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d '{"<harmless_column>": "<same value it already has>"}'
```

Choose a table and row the test user can normally update (for example their own profile). Run it once **before** the freeze and expect success (HTTP 204), then after it and expect `42501` / `permission denied for table`. An RLS message (`new row violates row-level security policy`) means the probe was invalid, not that the freeze works. Record both results.

## 4. Undo

Generate from the captured before-state; do not use a blanket `grant all`:

```sql
begin;
-- one line per captured row, write privileges only, e.g.:
grant insert, update, delete, truncate on public.<table> to <role>;
drop policy if exists staticbot_freeze_objects_insert on storage.objects;
drop policy if exists staticbot_freeze_objects_update on storage.objects;
drop policy if exists staticbot_freeze_objects_delete on storage.objects;
-- source only, on recovery: reactivate exactly the captured jobs
update cron.job set active = true where jobid in (<captured jobids>);
commit;
```

- **On the target after the final copy:** run everything except the cron line (target jobs start at reopening).
- **On the source:** run it only for pre-write recovery, or when the recovery period ends.
