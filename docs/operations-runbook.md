# Operations runbook (local synthetic prototype)

How to run, check, back up, restore and respond to problems in this prototype. **Synthetic data only.** This isn't a production runbook. Production hosting, managed backups, monitoring, on-call and incident response with real data are production gates ([production-readiness-gates.md](production-readiness-gates.md)).

## Environment variables

Read and checked in [src/server/environment.ts](../src/server/environment.ts).

| Variable              | Meaning                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`            | `development` (default), `test`, or `production`.                                                                                                                              |
| `ZEPORAH_DEV_SIGN_IN` | `1` turns on persona sign-in and **Reset synthetic data**. Never honoured when `NODE_ENV=production`. `bun run dev` sets it.                                                   |
| `ZEPORAH_DATA_DIR`    | Local database folder (default `.data/pglite`). The end-to-end tests use `.data/e2e-pglite`.                                                                                   |
| `ZEPORAH_READ_ONLY`   | `1` refuses every change (see Incident steps).                                                                                                                                 |
| `ZEPORAH_ENVIRONMENT` | A deliberate name for a non-development deployment. **Required with `NODE_ENV=production`, or the server refuses to open the database.** No production deployment is approved. |
| `ZEPORAH_APP_URL`     | The family address, e.g. `https://app.zeporah.co`. Set together with `ZEPORAH_CARE_URL`, or neither ([environments.md](architecture/environments.md#addresses)).               |
| `ZEPORAH_CARE_URL`    | The hospice team address, e.g. `https://care.zeporah.co`. A half or malformed pair stops the server at start-up.                                                               |

## Checking the system

**System status** (`/staff/status`, operations) shows:

- the environment, version, development gate and read-only state;
- whether the database is on the latest schema (migrations applied vs. available);
- whether the audit chain verifies.

**Audit review** (`/staff/audit`) re-verifies the chain on every load.

## Errors and references

An unexpected server error shows people a calm message with an 8-character **reference**. The server writes one JSON line to its own output: `level`, `at`, `ref`, error `type`, `message` and the top of the stack. **No request data** (no names, message text or record content) is written. Search the server output for the reference to find the error. There's no external monitoring service.

## Backup and restore (local database)

The database is an embedded PGlite folder. To back it up:

1. Stop the server (the folder must not change while it's copied).
2. Copy the whole folder, for example `cp -R .data/pglite .data/pglite-backup-YYYY-MM-DD`.
3. Optionally record a checksum: `find .data/pglite -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256`.

To restore:

1. Stop the server.
2. Move the current folder aside; don't delete it until the restore is confirmed.
3. Copy the backup back to `.data/pglite`.
4. Start the server, which applies any newer migrations on open.
5. Open **System status** and check that the schema is up to date and the audit chain verifies.

To reset to the synthetic seed instead, stop the server and run `bun run db:reset`, or press **Reset synthetic data** with the development gate on. This resets the local development database to the current synthetic seed. Do not use it against any non-synthetic environment.

## Incident steps (prototype)

| Situation                           | Step                                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Something may be writing wrong data | Restart with `ZEPORAH_READ_ONLY=1`. Everyone sees a "read-only right now" banner; reading and signing in still work; every change is refused with a calm message. Investigate, then restart without it. |
| A staff account may be misused      | Operations: **Team & coverage** → the person → **Deactivate**. Their sessions end at once, sign-in is refused, and their assignments and open work are released.                                        |
| Unsure whether records were altered | **Audit review** or **System status**: the hash chain is verified on every load. If it doesn't verify, stop and preserve the data folder as-is.                                                         |
| Need to know who did what           | **Audit review**, filtered by kind, household and period. Organization-level events (sign-ins, staff changes) are for operations only.                                                                  |

## Pilot controls in the product

- **One hospice per organization.** Staff see only their organization's households, and care guides only their assigned ones.
- **Accounts by invitation only.** There's no self sign-up.
- **Read-only mode** (above).
- **Production refuses to start without a named environment**, and the development gate never works in production.
- The pilot's intended size (one hospice, 10–25 households) is shown on the operations dashboard. It isn't enforced, because households are created only by the synthetic seed.
