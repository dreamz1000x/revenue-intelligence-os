# Production deployment and recovery

## Status and scope

The Railway project `revenue-intelligence-os` and its `production` environment
have been provisioned. They contain the `api` service, a private PostgreSQL
service and its volume, a public API domain, and the required runtime variables.
The first production deployment and production migrations have not run;
deployment verification and a recovery drill have not been completed. This
document remains the operator contract for that work and does not claim that
RIOS is production-ready.

The intended topology is deliberately small:

```text
Internet
  -> Railway HTTPS ingress
  -> one RIOS API service
  -> Railway private network
  -> one Railway PostgreSQL service
```

There is one API process and one database. O7 does not add Redis, queues,
microservices, replicas, high availability, or PgBouncer. Railway's PostgreSQL
template is treated as an unmanaged database service rather than a fully managed
DBaaS: RIOS operators remain responsible for migrations, backup configuration,
restore verification, and recovery procedures.

## Runtime and commands

- Node.js `24.19.0` is pinned in `.node-version`.
- pnpm `11.20.0` is pinned by `packageManager` in `package.json`.
- Build: `pnpm build`.
- Railway Start Command: `node dist/main.js`, so Node receives termination
  signals directly. The `pnpm start` package script is an equivalent convenience
  command, not the Railway production Start Command.
- Apply committed migrations: `pnpm db:migrate`, which runs
  `node dist/persistence/migrate.js` after the build artifact exists.

Production configuration is injected by Railway. Production must not depend on
an `.env` file.

### API environment

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL URL. Configure it as a Railway reference to the database service, conceptually `${{Postgres.DATABASE_URL}}`. |
| `STRIPE_WEBHOOK_SECRET` | Required secret for Stripe webhook signature verification. |
| `AUTH0_ISSUER` | Required HTTPS Auth0 issuer. |
| `AUTH0_AUDIENCE` | Required Auth0 API audience. |
| `AUTH0_ROLES_CLAIM` | Required access-token roles claim. |
| `LOG_LEVEL` | Optional: `debug`, `info`, `warn`, or `error`; defaults to `info`. |
| `HOST` | Optional; defaults to `0.0.0.0`. |
| `PORT` | Railway injects this in production; the local default is `3000`. |

The migration command consumes only `DATABASE_URL`; it must not require Stripe,
Auth0, or HTTP runtime configuration.

## Network, TLS, and proxy boundary

The API is exposed through Railway's public HTTPS ingress. PostgreSQL remains on
Railway's private network and must not be deliberately exposed to the Internet.
TLS terminates at the platform ingress.

`trustProxy` remains disabled. RIOS does not currently base authorization, rate
limiting, redirects, or cookies on forwarded client information, and TLS
termination alone is not a reason to trust forwarded headers. HSTS is deferred
until the deployed domain and proxy behavior have been verified.

## Migration ownership and release order

Schema changes use this flow:

```text
TypeScript schema
  -> pnpm db:generate
  -> review generated SQL and metadata
  -> commit
  -> CI verification
  -> pnpm build
  -> Railway pre-deploy: pnpm db:migrate
  -> deploy the API artifact
```

`pnpm db:migrate` applies only committed SQL migrations from `./drizzle` through
the Drizzle node-postgres migrator. It never performs `drizzle-kit push`. The
runner validates a non-empty PostgreSQL URL, does not print credentials or raw
errors, closes its pool on success and failure, and exits unsuccessfully if a
migration fails.

Railway pre-deploy is the sole owner of production migration execution. The API
startup path and any future replica must not run migrations. A failed migration
must block deployment; its provider-side pre-deploy timeout is configured to
300 seconds. Migrations `0000` through `0007` have been verified against a blank
PostgreSQL 18.4 database and on a no-op rerun, but have not yet run on Railway.

Routine releases should keep schema changes backward-compatible. Additive
changes are preferred. Destructive or incompatible changes require explicit
planning and an expand-deploy-contract sequence: expand the schema, deploy code
that tolerates both forms, migrate/backfill deliberately, deploy code using the
new form, then contract only after the old form is no longer used. RIOS does not
use automatic down migrations.

## Health, readiness, startup, and shutdown

- `GET /health` is process liveness and performs no dependency check.
- `GET /ready` performs PostgreSQL `SELECT 1` with a three-second handler timeout;
  it returns 200 when ready and 503 otherwise.
- Railway should use `/ready` as its deployment health-check path. This gates
  activation of a deployment; it is not continuous external monitoring.

Startup validates runtime configuration, creates dependencies, and listens. It
does not ping PostgreSQL before listening: readiness is the admission signal for
database-dependent traffic.

`SIGTERM` and `SIGINT` share the same graceful-shutdown lifecycle. The first
signal calls `app.close()` and repeated signals reuse that operation, so Fastify
closes exactly once. Its existing `onClose` hook closes the PostgreSQL pool. A
successful shutdown does not call `process.exit()`; a failure emits only the
fixed `graceful_shutdown_failed` operational event and sets exit code 1.

The provider configuration uses 30 seconds of connection draining. This is a
bounded operational target, not a guarantee that arbitrarily long requests will
finish.

## CI and deployment controls

The intended release sequence is:

1. Push `main` and require GitHub Actions typecheck, build, and tests to pass.
2. Railway deployment is allowed only after that CI result.
3. Railway's Railpack builder runs `pnpm build`.
4. Railway runs `pnpm db:migrate` as the pre-deploy command.
5. A successful pre-deploy allows Railway to start the new service version with
   `node dist/main.js`.
6. Railway requires `/ready` to return 200 before activating the deployment.
7. The operator verifies the deployed version and key endpoints.

Once the GitHub source is connected, enable Railway's "Wait for CI" deployment
control before the first production deployment. It is not enabled yet.

### Native IaC limitation

Railway native IaC was evaluated during O7. The current `railway@3.11.0` SDK
cannot represent the required provider-side `preDeployTimeoutSeconds` field, so
full-project IaC is intentionally deferred rather than committing a declaration
that would normalize the required 300-second timeout to `null`. The current
Railway provider configuration remains authoritative. Native IaC should be
revisited when the SDK officially supports this field; the repository does not
claim a committed or drift-free Railway IaC configuration.

## Backup strategy

Backups use three complementary layers; none is presently configured or tested.

### A. Point-in-time recovery

Enable Railway PostgreSQL point-in-time recovery during provisioning. Confirm
that WAL-based recovery and the then-current rolling base-backup retention are
active; the planning assumption is approximately four weeks, not a contractual
RPO or RTO. A restore must create a new sibling database while leaving the
source unchanged. Cutover is always a deliberate manual action.

### B. Volume backups

Configure daily and weekly volume backups after provisioning, plus a manual
backup before a high-risk operation. Volume backups are a second recovery path,
not a substitute for PITR. Their exact restoration capability must be verified
against the provisioned service before reliance.

### C. Provider-independent logical backup

Create periodic `pg_dump` backups in PostgreSQL custom format, stored outside
Git and outside the Railway service. Restore them with `pg_restore` into a
separate target database, validate the result, and only then consider cutover.
O7 does not add backup automation or cron jobs.

No contractual RPO or RTO is claimed until real schedules, retention, alerting,
and timed recovery drills have been measured.

## Recovery principles

Prefer fix-forward for application defects and compatible schema changes. A
code rollback is acceptable only when the current database schema remains
compatible. **Code rollback is not database rollback.** Use database recovery
only for data loss, corruption, or a harmful irreversible mutation; do not use
down migrations as a routine recovery mechanism.

### PITR procedure

1. Stop or isolate writes if continuing traffic could extend the damage.
2. Record the suspected incident time in UTC and preserve relevant safe logs.
3. In Railway, restore to a new sibling PostgreSQL service at a point before the
   harmful change; never restore over the source.
4. Keep the original database unchanged for investigation.
5. Connect privately to the restored target and verify migration history,
   representative row counts, financial invariants, and the incident-specific
   data. Expect writes after the selected restore point to be absent.
6. Start or point a controlled RIOS instance at the restored database and verify
   `/ready` plus targeted read-only application checks.
7. Obtain explicit approval for cutover, update the API's `DATABASE_URL`
   reference, redeploy, and verify readiness.
8. Monitor the new database and retain the old one until the recovery is accepted.

For a volume snapshot, use the snapshot-level restore capability Railway exposes
for the provisioned service. For a logical backup, restore with `pg_restore`
into a separate target. In both cases, validate before cutover. Never treat the
existence of a backup as proof that it is restorable.

## Failure matrix

| Failure | Observable symptom | First operator action | Do not |
| --- | --- | --- | --- |
| CI failure | Required GitHub Actions check is red. | Inspect and correct the failing change before deployment. | Bypass CI or deploy the commit manually. |
| Build failure | Railpack cannot produce the application artifact. | Inspect the build output and fix forward. | Run migrations or activate an older artifact as if it were the new release. |
| Migration failure | Pre-deploy exits non-zero and the release is blocked. | Inspect the fixed safe message and migration history, then plan a fix-forward migration. | Use `drizzle-kit push`, edit applied migrations, or retry blindly. |
| New deployment fails `/ready` | The candidate starts but readiness remains 503. | Verify `DATABASE_URL`, private networking, database availability, and migration completion without exposing credentials. | Activate the candidate or replace readiness with liveness. |
| Application regression with a DB-compatible schema | The active version returns incorrect responses while database integrity remains intact. | Fix forward or roll back code to a version compatible with the current schema. | Treat a code rollback as a database rollback. |
| Invalid production variable | Startup validation fails before the server listens. | Correct the Railway variable and redeploy. | Commit a secret or weaken validation. |
| Temporary PostgreSQL outage | `/ready` is 503 while `/health` may remain 200. | Restore connectivity and observe readiness recovery. | Run migrations, restore a backup, or restart repeatedly without evidence of data damage. |
| Destructive or bad migration | Schema incompatibility, migration error, or damaged schema/data appears. | Stop the rollout and writes where needed; assess fix-forward versus separate-target recovery. | Edit migration history, run a down migration automatically, or overwrite production blindly. |
| Accidental data mutation or deletion | Expected records or financial invariants are missing or wrong. | Stop writes, identify the UTC incident time, and restore a candidate database using PITR or another verified layer. | Cut over before validating the restored data. |
| Stripe webhook signing/configuration failure | Signed deliveries receive authentication/configuration errors and no supported effect is recorded. | Verify the configured endpoint secret and safe Stripe delivery evidence. | Disable signature verification, print the secret, or fabricate a Payment. |
| Graceful shutdown failure | `graceful_shutdown_failed` is emitted and the process exits non-zero. | Inspect platform lifecycle and safe logs, then reproduce with bounded diagnostics. | Log arbitrary errors or assume the pool closed successfully. |

## Operator deployment checklist

### Before deployment

- Confirm required CI checks are green.
- If the schema changed, review the committed SQL and assess compatibility with
  the previously running application.
- Take a manual pre-migration backup for an explicitly high-risk migration.
- Confirm required variables and secrets exist in Railway and no secret was
  committed.

### During deployment

- Confirm the Railpack build succeeds.
- Confirm the `pnpm db:migrate` pre-deploy step succeeds.
- Confirm the application starts and `/ready` becomes 200 before activation.

### After deployment

- Verify `GET /health` returns 200 and `GET /ready` returns 200.
- Verify an unauthenticated protected route returns 401.
- Verify a valid low-privilege identity receives the expected 403 or allowed
  response for its role; do not invent tokens in this runbook.
- Verify ADMIN `GET /metrics` works.
- Inspect structured startup/request logs for expected events and absence of
  secrets.
- Verify the Stripe webhook endpoint and configuration without bypassing
  signature validation or disclosing its secret.
- Inspect migration history and record the deployed Git commit.

## Provider configuration and validation checklist

- Preserve the existing Railway project, API service, PostgreSQL service, volume,
  public API domain, and `production` environment.
- Confirm the database continues to use private networking and has no intentional
  public URL.
- Confirm the provisioned API variables and `DATABASE_URL` service reference
  remain present without copying secrets into Git or logs.
- Confirm Node/pnpm build, `pnpm db:migrate` pre-deploy with its 300-second
  timeout, the Railway Start Command `node dist/main.js`, the `/ready` health
  check, and 30-second draining remain configured in the real Railway project.
- Keep provider configuration authoritative while native IaC is deferred.
- Enable Wait for CI and protect the production deployment workflow.
- Apply migrations `0000`-`0007` through pre-deploy and inspect the production
  migration history.
- Execute the operator deployment checklist above.
- Enable and inspect PITR; configure daily/weekly volume backups.
- Produce a logical custom-format backup outside Git and Railway.
- Perform and time a PITR restore to a sibling database, inspect the restored
  data, validate RIOS against it, and rehearse manual cutover/rollback.
- Validate this runbook against the real project and record measured recovery
  observations before declaring O7 closed.

## O7 closure criteria

O7 remains open until the first build, pre-deploy migration, startup, and
`/ready` activation are verified;
PITR and volume backups are enabled and inspected; a recovery drill restores to
a separate database whose contents are validated; and this operator runbook has
been exercised against the deployed environment.
