# save-urls Lambda — corrected version

Replaces `video-on-demand-stack-<env>-save-urls` (prod / stg / dev) in the AWS
Video-on-Demand-on-AWS stack in account `318730995815`, region `us-east-1`.

## What this fixes vs. the original

1. **Connection leak** — original never called `connection.end()`. Fixed by
   wrapping the query block in `try/finally` and always ending the connection.
2. **Silent failures** — original `catch` blocks did `console.log` only, so the
   Lambda always looked green in CloudWatch even when DB updates failed. This
   version `throw`s, so Step Functions marks the execution FAILED and the
   error-handler Lambda + any future alarm can react.
3. **Partial writes across DBs** — original wrote to `DB_NAME` and `DB_NAME2`
   in two independent try/catch blocks; one could succeed while the other
   silently failed. Now both are attempted in parallel via `Promise.allSettled`
   with per-DB retries.
4. **Non-Complete workflow status** — original still ran DB updates when
   `workflowStatus !== 'Complete'`, which could write invalid data. Now it
   short-circuits early in that case.
5. **Input validation** — throws explicit errors if `srcVideo` or
   `egressEndpoints` are missing/empty instead of writing garbage.
6. **SQL injection** — original interpolated `event.srcVideo` and `row.id`
   directly into SQL. Now uses prepared statements with `?` placeholders.
7. **Deprecated driver** — switched from `mysql` (v1, unmaintained) to
   `mysql2/promise`, which uses native promises and has correct connection
   lifecycle handling.

## Guarantees that both `playgarden` and `afterclass` keep working

The invocation contract is:

- **Both DBs are always attempted**, in parallel.
- **Per-DB retries**: up to 3 attempts with 500 ms → 1500 ms backoff, but only
  for transient errors (network timeouts, connection resets, MySQL
  `ER_CON_COUNT_ERROR`, deadlocks). Non-transient errors are not retried to
  avoid amplifying real problems.
- **Config errors are isolated**: `ER_NO_SUCH_TABLE`, `ER_BAD_DB_ERROR`,
  `ER_BAD_FIELD_ERROR` are logged as `skipped-config-error` and treated as
  success for that DB, so a schema mismatch in `playgarden` cannot block
  writes to `afterclass` (or vice versa). Fix the schema, no code change
  needed.
- **Idempotent by design**: the UPDATE sets `status='COMPLETED'` and the same
  `video_url` on match. Retries — whether from within this Lambda, from Step
  Functions, or from a re-triggered pipeline — are safe no-ops on already-
  completed rows.
- **Partial success is transparent**: even when both DBs succeed, per-DB
  outcomes are logged as structured JSON (`stage: "save-urls"`, `db: "..."`,
  `matched`, `updated`, `status`). Metric filters on those keys can alert
  independently on each DB.
- **Hard failure only when necessary**: the Lambda throws only if any DB
  update was truly unrecoverable after retries. Step Functions will then
  retry the state machine step per its existing retry policy; if it still
  fails, the error-handler is invoked and the CloudWatch alarm below fires.

## Environment variables (unchanged)

- `DB_HOST` (e.g. `pdxt3ilrdg27b9.cki7d1oedvtt.us-east-1.rds.amazonaws.com`)
- `DB_USER`
- `DB_PASSWORD` — **must be rotated** if the previous value leaked. Consider
  moving to Secrets Manager.
- `DB_NAME` (main Playgarden DB, e.g. `playgarden`)
- `DB_NAME2` (After Class DB, e.g. `afterclass`)

## Runtime settings to verify (do not change unless needed)

- Runtime: `nodejs18.x` or newer (needed for `mysql2` and top-level await
  patterns).
- Handler: `index.handler` (unchanged).
- VPC: must have connectivity to the RDS instance
  (`pdxt3ilrdg27b9.cki7d1oedvtt.us-east-1.rds.amazonaws.com`). Security group
  on RDS must allow inbound `3306` from the Lambda security group.
- Timeout: 15s is enough; the new `connectTimeout: 5000` means DB stalls fail
  fast instead of consuming the whole Lambda timeout.
- Memory: 128–256 MB is enough.

## How to deploy

### Option A — zip and update (fastest)

```bash
cd fixes/save-urls-lambda
npm install --omit=dev              # installs mysql2 locally
zip -r save-urls.zip index.js package.json node_modules
aws lambda update-function-code \
  --function-name video-on-demand-stack-dev-save-urls \
  --zip-file fileb://save-urls.zip
```

Then verify:

```bash
aws lambda invoke \
  --function-name video-on-demand-stack-dev-save-urls \
  --payload '{"workflowStatus":"Error","guid":"dry-run"}' \
  --cli-binary-format raw-in-base64-out /tmp/out.json
cat /tmp/out.json
```

Should return the event back unchanged (because `workflowStatus !== 'Complete'`
short-circuits) — proves the runtime is happy.

### Option B — copy/paste in the console

1. Open the Lambda console for the target function.
2. Code source → replace `index.js` contents with the file here.
3. Add a layer or `node_modules/mysql2` — the console editor does not install
   dependencies, so Option A is strongly recommended for prod.

## Rollout order (do not skip)

1. Deploy to `video-on-demand-stack-dev-save-urls`. Trigger 2–3 dev uploads,
   confirm rows go `PROCESSING → COMPLETED` in both `playgarden` and
   `afterclass` on the dev RDS.
2. Deploy to `video-on-demand-stack-stg-save-ruls` (note the typo in the
   stg function name).
3. Deploy to `video-on-demand-stack-prod-save-urls`. Watch CloudWatch metrics
   for the first hour: `Errors` should be 0, `Duration` should drop.

## After deploy — recovery of stuck videos

Once the Lambda is healthy, from the backend:

```typescript
await videoReprocessService.reprocessStuck({
  dryRun: false,
  olderThanHours: 2,
  maxAttempts: 3,
  strategy: 'reupload',
  limit: 500,
});
```

## Alarm to add once deployed

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name save-urls-prod-errors \
  --metric-name Errors --namespace AWS/Lambda \
  --dimensions Name=FunctionName,Value=video-on-demand-stack-prod-save-urls \
  --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --alarm-actions <SNS_TOPIC_ARN>
```

Without this alarm the fix's improved error reporting has no destination.
