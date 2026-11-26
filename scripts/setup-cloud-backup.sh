#!/usr/bin/env bash
# Estadat Al-Borg Restaurant ERP — Daily PostgreSQL -> Cloud Storage Backup Provisioning
# Provisions:
#   1. Regional GCS bucket in europe-west2 with object versioning & lifecycle retention
#   2. IAM permissions for the Cloud Run service account
#   3. Native Cloud SQL automated daily backups + Point-in-Time Recovery (PITR)
#   4. Google Cloud Scheduler daily cron job (02:00 Africa/Cairo) targeting /api/erp/backups/run

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-ecstatic-bindery-671nt}"
REGION="${GCP_REGION:-europe-west2}"
SQL_INSTANCE="${CLOUD_SQL_INSTANCE:-ai-studio-a7b5b665}"
BUCKET_NAME="${GCS_BACKUP_BUCKET:-estadat-alborg-erp-backups}"
SERVICE_ACCOUNT_EMAIL="${CLOUD_RUN_SERVICE_ACCOUNT:-}"
APP_URL="${APP_URL:?Set APP_URL to your deployed Cloud Run URL (e.g. https://...run.app)}"
BACKUP_CRON_SECRET="${BACKUP_CRON_SECRET:?Set BACKUP_CRON_SECRET to match Cloud Run env}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

echo "==> 1. Creating regional Cloud Storage bucket gs://${BUCKET_NAME} in ${REGION}..."
if ! gcloud storage buckets describe "gs://${BUCKET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --default-storage-class=STANDARD \
    --uniform-bucket-level-access
fi

echo "==> 2. Enabling object versioning and ${RETENTION_DAYS}-day retention lifecycle..."
gcloud storage buckets update "gs://${BUCKET_NAME}" --versioning

LIFECYCLE_JSON="$(mktemp)"
cat > "${LIFECYCLE_JSON}" <<EOF
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": ${RETENTION_DAYS}, "isLive": false }
    },
    {
      "action": { "type": "SetStorageClass", "storageClass": "NEARLINE" },
      "condition": { "age": 30 }
    }
  ]
}
EOF
gcloud storage buckets update "gs://${BUCKET_NAME}" --lifecycle-file="${LIFECYCLE_JSON}"
rm -f "${LIFECYCLE_JSON}"

if [[ -n "${SERVICE_ACCOUNT_EMAIL}" ]]; then
  echo "==> 3. Granting roles/storage.objectAdmin to ${SERVICE_ACCOUNT_EMAIL}..."
  gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
    --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
    --role="roles/storage.objectAdmin"
fi

echo "==> 4. Enabling Cloud SQL automated daily backups & PITR on ${SQL_INSTANCE}..."
gcloud sql instances patch "${SQL_INSTANCE}" \
  --project="${PROJECT_ID}" \
  --backup-start-time="02:00" \
  --retained-backups-count="${RETENTION_DAYS}" \
  --enable-point-in-time-recovery \
  --quiet

echo "==> 5. Creating/updating Google Cloud Scheduler daily job (0 2 * * * Africa/Cairo)..."
JOB_NAME="alborg-erp-daily-pg-backup"
TARGET_URI="${APP_URL%/}/api/erp/backups/run"

if gcloud scheduler jobs describe "${JOB_NAME}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "${JOB_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --schedule="0 2 * * *" \
    --time-zone="Africa/Cairo" \
    --uri="${TARGET_URI}" \
    --http-method=POST \
    --headers="Content-Type=application/json,X-Backup-Scheduler-Secret=${BACKUP_CRON_SECRET}" \
    --message-body='{"triggerType":"cloud_scheduler"}'
else
  gcloud scheduler jobs create http "${JOB_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --schedule="0 2 * * *" \
    --time-zone="Africa/Cairo" \
    --uri="${TARGET_URI}" \
    --http-method=POST \
    --headers="Content-Type=application/json,X-Backup-Scheduler-Secret=${BACKUP_CRON_SECRET}" \
    --message-body='{"triggerType":"cloud_scheduler"}'
fi

echo "✅ Cloud backup infrastructure configured successfully."
