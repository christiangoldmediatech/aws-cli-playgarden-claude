# aws-cli-playgarden-claude

Working project to **review and document Playgarden's AWS architecture** using Claude Code together with the AWS CLI.

## Purpose

Serve as an isolated local environment to explore Playgarden's AWS infrastructure (ECS, Lambdas, S3, RDS, Video on Demand, pipelines, etc.) in a **safe, read-only** way, assisted by Claude Code.

## Structure

```
.
├── .aws/               # Local CLI config (IGNORED by git)
│   ├── config          # 'claude-readonly' profile pointing to us-east-1
│   └── credentials     # Access keys for the claude-readonly IAM user
├── .claude/
│   └── settings.json   # Forces Claude Code to use the read-only profile
├── .gitignore
└── README.md
```

## AWS Access

All operations run as the IAM user **`claude-readonly`** (account `318730995815`), whose permissions are intentionally restricted so that no resource can be modified.

```bash
aws sts get-caller-identity
```

The `.claude/settings.json` file forces the use of this profile automatically within the project:

```json
{
  "env": {
    "AWS_PROFILE": "claude-readonly",
    "AWS_CONFIG_FILE": ".../.aws/config",
    "AWS_SHARED_CREDENTIALS_FILE": ".../.aws/credentials"
  }
}
```

## Typical usage

1. Open the project with Claude Code.
2. Ask Claude to explore, describe, or audit specific areas of the architecture, for example:
   - "Describe Playgarden's ECS stacks across the 3 environments."
   - "List the Lambdas related to crons and what each one does."
   - "Review the video on demand pipeline configuration."
3. Claude responds by running read-only AWS CLI commands.

## Security

- The `.aws/` directory contains credentials and is **never** pushed to the repository (see `.gitignore`).
- The IAM user has no write permissions on any relevant service.
- Do not commit files containing access keys, secret keys, tokens, or DB dumps.
