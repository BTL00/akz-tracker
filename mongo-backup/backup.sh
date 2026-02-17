#!/bin/sh
set -e

TIMESTAMP=$(date -u +"%Y-%m-%d_%H-%M")
ARCHIVE="/backups/akz-${TIMESTAMP}.gz"
RETENTION=${BACKUP_RETENTION_DAYS:-14}

echo "[backup] Starting dump at $(date -u)"
mongodump \
  --uri="${MONGO_URI:-mongodb://mongo:27017/akz-tracker}" \
  --gzip \
  --archive="${ARCHIVE}"

echo "[backup] Dump written to ${ARCHIVE}"

# Prune archives older than RETENTION days
find /backups -name "akz-*.gz" -type f -mtime +${RETENTION} -delete
echo "[backup] Pruned archives older than ${RETENTION} days"
echo "[backup] Done."
