FROM mongo:7

# Use supercronic (static binary) to avoid apt and GPG key issues during build.
ADD https://github.com/aptible/supercronic/releases/download/v0.2.29/supercronic-linux-amd64 /usr/local/bin/supercronic
RUN chmod +x /usr/local/bin/supercronic

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

# Entrypoint: write the cron schedule from env, then run supercronic in foreground
ENTRYPOINT ["/bin/sh", "-c", \
  "mkdir -p /etc/cron.d && \
   echo \"${BACKUP_SCHEDULE:-0 2 * * *} /backup.sh >> /var/log/backup.log 2>&1\" > /etc/cron.d/mongo-backup && \
   chmod 0644 /etc/cron.d/mongo-backup && \
   echo '[backup-cron] Scheduled: '\"${BACKUP_SCHEDULE:-0 2 * * *}\" && \
   exec /usr/local/bin/supercronic /etc/cron.d/mongo-backup"]
