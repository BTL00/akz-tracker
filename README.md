# AKZ Tracker

Live boat position tracker built on OpenSeaMap. Supports real-time positions via WebSocket, NMEA TCP, and SignalK, with expedition playback and an admin panel.

## Features

- Live boat positions on an interactive OpenSeaMap
- Expedition recording and playback with speed control
- GPX import and export
- NMEA 0183 TCP listener and SignalK client (optional)
- AT4 GPS Tracker support with binary GPRS protocol (optional)
- PWA — installable on mobile
- Dark / light theme

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/akz-tracker.git
cd akz-tracker

# 2. Create your environment file and set a strong API key
cp .env.example .env
# Edit .env and replace API_KEY with a secure random string

# 3. Start all services
docker compose up -d

# 4. Open http://localhost in your browser
```

The admin panel is accessible via the lock icon. Use the `API_KEY` value from your `.env` to log in.

## Environment Variables

All variables are set in your `.env` file (copied from `.env.example`).

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | ✅ | — | Admin authentication key. **Must be changed before deployment.** |
| `MONGO_URI` | — | `mongodb://mongo:27017/akz-tracker` | MongoDB connection string |
| `NMEA_TCP_ENABLED` | — | `false` | Enable NMEA 0183 TCP listener |
| `NMEA_TCP_PORT` | — | `10110` | Port for NMEA TCP listener |
| `SIGNALK_ENABLED` | — | `false` | Enable SignalK client |
| `SIGNALK_URL` | — | — | SignalK server WebSocket URL |
| `SIGNALK_TOKEN` | — | — | SignalK authentication token |
| `AT4_TCP_ENABLED` | — | `false` | Enable AT4 GPS tracker TCP listener |
| `AT4_TCP_PORT` | — | `15110` | Port for AT4 TCP listener |

## Deployment

### VPS (recommended)

1. Copy the repository to your server.
2. Configure `.env` with a real `API_KEY` and your `MONGO_URI`.
3. For HTTPS, edit `nginx/nginx.conf`: uncomment the HTTPS server block, replace `<your-domain.com>` with your domain, then run Certbot alongside Docker Compose.

```bash
docker compose up -d
```

## License

[MIT](LICENSE)

## Backups

Automated MongoDB backups run inside the `mongo-backup` container on the schedule defined by `BACKUP_SCHEDULE` (default `0 2 * * *` — 2 AM UTC daily). Compressed dump archives are written to `./backups/` on the host and pruned after `BACKUP_RETENTION_DAYS` days (default 7).

```bash
# Trigger a manual backup immediately
docker compose exec mongo-backup /backup.sh

# List existing archives
ls ./backups/

# Restore from an archive
docker compose exec -T mongo mongorestore \
  --uri mongodb://mongo:27017/akz-tracker \
  --gzip --archive < ./backups/akz-YYYY-MM-DD_HH-MM.gz
```

To copy backups offsite, add a post-backup `rsync` or `rclone` call to `mongo-backup/backup.sh`.
