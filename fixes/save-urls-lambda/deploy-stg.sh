#!/usr/bin/env bash
# Deploy save-urls fix to STAGING. Idempotent per-step.
# Function name has a typo in the stack: save-ruls (not save-urls).
# Run one command at a time by calling with the step name:
#   ./deploy-stg.sh step1        # runtime + timeout
#   ./deploy-stg.sh step2        # publish version (backup)
#   ./deploy-stg.sh step3        # download current code (backup)
#   ./deploy-stg.sh step4        # upload new zip
#   ./deploy-stg.sh step5        # smoke test (no DB writes)
#   ./deploy-stg.sh rollback     # restore previous zip
#   ./deploy-stg.sh status       # show current runtime/timeout/state

set -euo pipefail

FN=video-on-demand-stack-stg-save-ruls
REGION=us-east-1
ZIP_NEW="/Users/christianborja/Documents/GMT Projects/aws-cli/fixes/save-urls-lambda/save-urls.zip"
BACKUP_DIR="$HOME/Desktop/lambda-backups"
BACKUP_ZIP="$BACKUP_DIR/save-urls-stg-backup-2026-09-23.zip"

step="${1:-help}"

case "$step" in
  help)
    grep -E '^#' "$0" | sed 's/^# //' | head -13
    ;;

  status)
    aws lambda get-function-configuration \
      --function-name "$FN" --region "$REGION" \
      --output text \
      --query '[LastUpdateStatus,Runtime,Timeout,MemorySize,CodeSize,LastModified]'
    ;;

  step1)
    echo ">> step1 [stg]: updating runtime to nodejs20.x and timeout to 20s"
    aws lambda update-function-configuration \
      --function-name "$FN" --region "$REGION" \
      --runtime nodejs20.x --timeout 20 \
      --output text \
      --query '[LastUpdateStatus,Runtime,Timeout]'
    echo ">> waiting for update to finish..."
    aws lambda wait function-updated --function-name "$FN" --region "$REGION"
    echo ">> done. current state:"
    aws lambda get-function-configuration \
      --function-name "$FN" --region "$REGION" \
      --output text \
      --query '[LastUpdateStatus,Runtime,Timeout]'
    ;;

  step2)
    echo ">> step2 [stg]: publishing version as backup"
    aws lambda publish-version \
      --function-name "$FN" --region "$REGION" \
      --description "Pre-fix backup - original save-ruls (stg)" \
      --output text \
      --query '[Version,LastModified,CodeSha256]'
    ;;

  step3)
    echo ">> step3 [stg]: downloading current code as backup"
    mkdir -p "$BACKUP_DIR"
    URL=$(aws lambda get-function \
      --function-name "$FN" --region "$REGION" \
      --query 'Code.Location' --output text)
    curl -sSL "$URL" -o "$BACKUP_ZIP"
    ls -lh "$BACKUP_ZIP"
    echo ">> backup saved at: $BACKUP_ZIP"
    ;;

  step4)
    echo ">> step4 [stg]: uploading new zip"
    if [[ ! -f "$ZIP_NEW" ]]; then
      echo "ERROR: zip not found: $ZIP_NEW" >&2
      exit 1
    fi
    if [[ ! -f "$BACKUP_ZIP" ]]; then
      echo "ERROR: run step3 first to create backup at $BACKUP_ZIP" >&2
      exit 1
    fi
    aws lambda update-function-code \
      --function-name "$FN" --region "$REGION" \
      --zip-file "fileb://$ZIP_NEW" \
      --output text \
      --query '[LastUpdateStatus,CodeSize,LastModified]'
    echo ">> waiting for update to finish..."
    aws lambda wait function-updated --function-name "$FN" --region "$REGION"
    echo ">> done. current state:"
    aws lambda get-function-configuration \
      --function-name "$FN" --region "$REGION" \
      --output text \
      --query '[LastUpdateStatus,Runtime,Timeout,CodeSize]'
    ;;

  step5)
    echo ">> step5 [stg]: synthetic smoke test (no DB writes)"
    out=$(mktemp -t save-urls-smoke-stg.XXXXXX.json)
    aws lambda invoke \
      --function-name "$FN" --region "$REGION" \
      --payload '{"workflowStatus":"Error","guid":"smoke-test-stg-2026-09-23"}' \
      --cli-binary-format raw-in-base64-out \
      "$out"
    echo ">> response body:"
    cat "$out"
    echo
    ;;

  rollback)
    echo ">> rollback [stg]: restoring $BACKUP_ZIP"
    if [[ ! -f "$BACKUP_ZIP" ]]; then
      echo "ERROR: no backup found at $BACKUP_ZIP" >&2
      exit 1
    fi
    aws lambda update-function-code \
      --function-name "$FN" --region "$REGION" \
      --zip-file "fileb://$BACKUP_ZIP" \
      --output text \
      --query '[LastUpdateStatus,CodeSize]'
    aws lambda wait function-updated --function-name "$FN" --region "$REGION"
    echo ">> rollback done. current state:"
    aws lambda get-function-configuration \
      --function-name "$FN" --region "$REGION" \
      --output text \
      --query '[LastUpdateStatus,Runtime,Timeout,CodeSize]'
    ;;

  *)
    echo "Unknown step: $step" >&2
    echo "Usage: $0 {status|step1|step2|step3|step4|step5|rollback|help}" >&2
    exit 1
    ;;
esac
