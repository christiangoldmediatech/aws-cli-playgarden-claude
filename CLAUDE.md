# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

This is **not a code project**. It is a working environment for auditing and documenting Playgarden's AWS architecture using Claude Code with the AWS CLI. There is no build, no tests, no app to run — the "work" is running read-only AWS CLI commands to explore infrastructure and summarize findings for the user.

## AWS access model (critical)

- All AWS operations run as IAM user **`claude-readonly`** in account **`318730995815`**, region `us-east-1`.
- The user's permissions are intentionally narrow — expect `AccessDenied` / `UnauthorizedOperation` on many common calls (e.g. `ec2:Describe*`, `s3:ListAllMyBuckets`, `rds:DescribeDBInstances`, `lambda:ListFunctions`, `cloudformation:ListStacks`, `iam:ListGroups`). These denials are not bugs — do not try to "fix" them or suggest changing policies. Treat each denial as signal about what this identity can see and keep going with other tools.
- What generally *does* work: `sts:GetCallerIdentity`, `iam:ListUsers`, `iam:ListRoles`, `iam:ListPolicies`, `iam:ListAttached*Policies`, `iam:GetPolicy*`. Most architectural discovery in this repo is done by reading IAM role/policy names and inferring workloads from them.
- `.claude/settings.json` already sets `AWS_PROFILE`, `AWS_CONFIG_FILE`, and `AWS_SHARED_CREDENTIALS_FILE` so AWS CLI calls from Claude Code automatically use the right profile. Do not override these; do not pass `--profile` flags unnecessarily.
- Verify identity before doing anything AWS-related: `aws sts get-caller-identity`.

## Known workloads in this account (context for discovery)

Previously identified from IAM role patterns (always re-verify — this snapshot can drift):

- **Playgarden** — main workload. ECS stacks in `devel`/`staging`/`production` with CodePipeline + CodeBuild + Task Execution roles. Business Lambdas: `BirthdayWishes`, `HappyBirthDay`, `lessonReminders`, `sendLiveClassStarting`, `weekly-children-progress`, `playgarden-abandoned-cart`, `playgarden-cron-recurring-live-classes`, `playgarden-crons-check-subscription`, `playgarden-new-users`. Dropbox→S3 pipeline (`pg-dropbox-to-s3-prod`). Alexa skill (`PLaygardenSkill`).
- **Pearson** — separate ECS-based API+Web workload, dev/stg/prod.
- **Video on Demand** — AWS VOD reference solution stacks (MediaConvert, MediaPackage, Step Functions, DynamoDB, SNS, SQS) across dev/stg/prod.
- **Other**: WordPress on EC2, Laravel Vapor, Elastic Beanstalk, CodePipeline Slack notifiers, AWS Chatbot.

When the user asks to dig into one of these, expect to map it primarily via IAM role names and any APIs that happen to be allowed for the role (not EC2/RDS/Lambda describe APIs).

## Repository structure (small by design)

```
.aws/               # Gitignored. Holds claude-readonly credentials + config.
.claude/            # Claude Code project settings (AWS env vars).
README.md           # Human-facing project description.
```

`.aws/` is in `.gitignore` — never stage files from it. Never commit credentials, access keys, tokens, SQL dumps, or anything that looks like customer data. `.claude/settings.json` is committed and contains no secrets (only env var pointers) — that's intentional.

## Git workflow notes

- This repo's `main` tracks `origin/main` on `github.com/christiangoldmediatech/aws-cli-playgarden-claude`.
- An early misstep left a `.git` at `/Users/christianborja/` (the user's home). If `git rev-parse --show-toplevel` ever returns the home directory again, stop — do not run `git add .`, it would stage SSH keys, AWS credentials, shell history, etc. Fix by removing the stray `.git` from `$HOME` and re-initializing inside the project folder.

## Response style for this project

- The user works in Spanish by default; mirror that unless they switch.
- When surveying the account, run read-only discovery calls in parallel (identity, IAM listings, service probes) and summarize findings — don't narrate each denial. One line per major finding is enough.
- Offer concrete drill-down options at the end of a summary so the user can pick a direction, rather than dumping everything at once.
