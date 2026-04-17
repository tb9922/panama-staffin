# Panama Staffing - Deployment Guide

The current hardening and verification baseline is summarized in
[HARDENING_SUMMARY_2026-03-29.md](HARDENING_SUMMARY_2026-03-29.md).

## Prerequisites

- Ubuntu 22.04+ LTS (or similar)
- Node.js 22 LTS (via nvm)
- PostgreSQL 16 (Docker or native)
- Nginx
- PM2 (`npm install -g pm2`)
- Certbot (for SSL)
- Git

## First-Time Server Setup

### 1. System

```bash
# Non-root user
adduser deploy
usermod -aG sudo deploy

# Firewall
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable

# Auto security updates
apt install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

### 2. Node.js

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
npm install -g pm2
```

### 3. PostgreSQL (Docker)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# Start database
cd /var/www/panama-staffing
docker compose up -d

# Wait for health check, then migrate
sleep 10
node scripts/migrate.js
```

### 4. Application

```bash
# Clone
git clone git@github.com:tb9922/panama-staffin.git /var/www/panama-staffing
cd /var/www/panama-staffing

# Dependencies
npm ci --omit=dev

# Environment
cp .env.example .env
# Edit .env - set real JWT_SECRET, DB_PASSWORD, ALLOWED_ORIGIN,
# METRICS_TOKEN, backup target(s), and any Sentry DSN/sample-rate values
nano .env

# Build frontend
npm run build

# Create logs directory
mkdir -p logs backups/db
```

### 5. PM2

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup    # follow printed instructions to enable auto-start on boot
```

Connection budget rule:

```text
PM2 workers * DB_POOL_MAX <= postgres max_connections - reserve
```

With the default PM2 `instances: 4` and `DB_POOL_MAX=20`, the app consumes up to
80 client connections and leaves headroom on PostgreSQL's default
`max_connections=100`. If you raise either number, raise PostgreSQL capacity too.

### 6. Nginx + SSL

```bash
# Install
apt install nginx certbot python3-certbot-nginx

# Configure
cp nginx.conf /etc/nginx/sites-available/panama
ln -s /etc/nginx/sites-available/panama /etc/nginx/sites-enabled/
# Edit: replace panama.yourdomain.com with your domain
nano /etc/nginx/sites-available/panama

nginx -t
systemctl reload nginx

# SSL
certbot --nginx -d panama.yourdomain.com
# Certbot auto-renews via systemd timer
```

### 7. Backups

```bash
chmod +x scripts/backup-db.sh scripts/restore-db.sh

# Test backup
./scripts/backup-db.sh

# Optional: verify restore immediately after backup
VERIFY_AFTER_BACKUP=true ./scripts/backup-db.sh

# Schedule daily at 2am
crontab -e
# Add: 0 2 * * * /var/www/panama-staffing/scripts/backup-db.sh >> /var/log/panama-backup.log 2>&1
```

Recommended production backup variables:

- `BACKUP_S3_BUCKET` for offsite S3 copies
- `BACKUP_SCP_TARGET` for SSH/NAS copies
- `VERIFY_AFTER_BACKUP=true` for periodic restore verification
- `HEALTHCHECK_URL` for success/failure pings from `verify-backup.sh`

### 8. Monitoring

Set up an external uptime monitor (UptimeRobot, Better Uptime) to ping
`https://panama.yourdomain.com/health` every 5 minutes. Alert via SMS/email on failure.

The app also exposes `/readiness` which returns 503 during graceful shutdown if you
place it behind a load balancer that supports readiness probes.

If `METRICS_TOKEN` is set, the app also exposes `/metrics` and requires:

```text
Authorization: Bearer <METRICS_TOKEN>
```

## Deploying Updates

```bash
cd /var/www/panama-staffing

# Pull latest code
git pull origin main

# Install any new dependencies
npm ci --omit=dev

# Run new migrations (if any)
node scripts/migrate.js

# Rebuild frontend (if frontend changes)
npm run build

# Restart application (rolling restart in cluster mode - near-zero downtime)
pm2 restart panama
```

### Quick Deploy

```bash
cd /var/www/panama-staffing && git pull && npm ci --omit=dev && node scripts/migrate.js && npm run build && pm2 restart panama
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | 64-char hex string for JWT signing |
| `ADMIN_PASSWORD_HASH` | No | Optional legacy seed account hash |
| `VIEWER_PASSWORD_HASH` | No | Optional legacy seed account hash |
| `DB_PASSWORD` | Yes | PostgreSQL password |
| `DB_HOST` | No | Default: localhost |
| `DB_PORT` | No | Default: 5432 |
| `DB_NAME` | No | Default: panama_dev |
| `DB_USER` | No | Default: panama |
| `DB_POOL_MAX` | No | Default: 20. Multiply by PM2 worker count to size PostgreSQL capacity |
| `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` | No | Default: 60000. Kills stuck idle transactions |
| `PORT` | No | Default: 3001 |
| `ALLOWED_ORIGIN` | Yes | CORS origin (for example `https://panama.yourdomain.com`) |
| `NODE_ENV` | No | Set to `production` via PM2 |
| `JWT_EXPIRES_IN` | No | Default: `4h` |
| `METRICS_TOKEN` | No | Enables `/metrics` when set |
| `SENTRY_DSN` | No | Backend Sentry DSN |
| `SENTRY_TRACES_SAMPLE_RATE` | No | Backend performance tracing sample rate (0-1) |
| `VITE_SENTRY_DSN` | No | Frontend Sentry DSN |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | No | Frontend tracing sample rate (0-1) |
| `BACKUP_S3_BUCKET` | No | Offsite backup bucket for `backup-db.sh` |
| `BACKUP_SCP_TARGET` | No | Alternate offsite SSH/NAS backup target |
| `VERIFY_AFTER_BACKUP` | No | Runs restore verification after backup when `true` |
| `HEALTHCHECK_URL` | No | Healthchecks.io style ping URL for backup verification |

Generate secrets:

```bash
# JWT secret
node -e "require('crypto').randomBytes(32).toString('hex')"

# Password hash
node -e "require('bcryptjs').hash('your-password', 12).then(console.log)"
```

## Verification Checklist

After deployment, verify:

- [ ] `https://panama.yourdomain.com/health` returns `status: "ok"` and `db: "ok"`
- [ ] `https://panama.yourdomain.com/readiness` returns `status: "ready"`
- [ ] Login works with admin credentials
- [ ] Data loads for an existing home
- [ ] `pm2 status` shows `online`
- [ ] `pm2 logs panama --lines 20` shows no startup errors
- [ ] SSL certificate is valid
- [ ] Backup script runs: `./scripts/backup-db.sh`
- [ ] Metrics endpoint responds when enabled: `curl -H "Authorization: Bearer $METRICS_TOKEN" https://panama.yourdomain.com/metrics`
- [ ] PM2 logs show request IDs on live traffic
- [ ] Sentry receives backend and frontend events when configured

## Known Open Hardening Item

- CSP still relies on `style-src 'unsafe-inline'` in nginx. That remains intentionally
  out of this tranche and should be addressed in a separate frontend/CSP pass.
