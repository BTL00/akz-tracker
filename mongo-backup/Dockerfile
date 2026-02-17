FROM mongo:7

# Install tini (clean signal handling) and dcron (lightweight cron daemon)
# Ensure keyrings are readable by _apt to avoid GPG errors on update.
RUN set -e; \
  chmod a+r /etc/apt/trusted.gpg.d/*.gpg /usr/share/keyrings/*.gpg 2>/dev/null || true; \
  apt-get update; \
  apt-get install -y --no-install-recommends tini dcron; \
  rm -rf /var/lib/apt/lists/*

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

# Entrypoint: write the cron schedule from env, then run crond in foreground
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/bin/sh", "-c", \
  "echo \"${BACKUP_SCHEDULE:-0 2 * * *} /backup.sh >> /var/log/backup.log 2>&1\" > /etc/cron.d/mongo-backup && \
   chmod 0644 /etc/cron.d/mongo-backup && \
   crontab /etc/cron.d/mongo-backup && \
   echo '[backup-cron] Scheduled: '\"${BACKUP_SCHEDULE:-0 2 * * *}\" && \
   crond -f -l 8"]
