# Panama Staffing — Deployment Guide

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
cd /var/www/panama
docker compose up -d

# Wait for health check, then migrate
sleep 10
node scripts/migrate.js
```

### 4. Application

```bash
# Clone
git clone git@github.com:tb9922/panama-staffin.git /var/www/panama
cd /var/www/panama

# Dependencies
npm ci --omit=dev

# Environment
cp .env.example .env
# Edit .env — set real JWT_SECRET, password hashes, DB_PASSWORD, ALLOWED_ORIGIN
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

# Schedule daily at 2am
crontab -e
# Add: 0 2 * * * /var/www/panama/scripts/backup-db.sh >> /var/log/panama-backup.log 2>&1
```

### 8. Monitoring

Set up an external uptime monitor (UptimeRobot, Better Uptime) to ping `https://panama.yourdomain.com/health` every 5 minutes. Alert via SMS/email on failure.

---

## Deploying Updates

```bash
cd /var/www/panama

# Pull latest code
git pull origin main

# Install any new dependencies
npm ci --omit=dev

# Run new migrations (if any)
node scripts/migrate.js

# Rebuild frontend (if frontend changes)
npm run build

# Restart application (zero-downtime with PM2)
pm2 restart panama
```

### Quick Deploy (one-liner)

```bash
cd /var/www/panama && git pull && npm ci --omit=dev && node scripts/migrate.js && npm run build && pm2 restart panama
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | 64-char hex string for JWT signing |
| `ADMIN_PASSWORD_HASH` | Yes | bcrypt hash (cost 12) |
| `VIEWER_PASSWORD_HASH` | Yes | bcrypt hash (cost 12) |
| `DB_PASSWORD` | Yes | PostgreSQL password |
| `DB_HOST` | No | Default: localhost |
| `DB_PORT` | No | Default: 5432 |
| `DB_NAME` | No | Default: panama_dev |
| `DB_USER` | No | Default: panama |
| `PORT` | No | Default: 3001 |
| `ALLOWED_ORIGIN` | No | Default: http://localhost:5173 |
| `NODE_ENV` | No | Set to "production" via PM2 |

Generate secrets:
```bash
# JWT secret
node -e "require('crypto').randomBytes(32).toString('hex')"

# Password hash
node -e "require('bcryptjs').hash('your-password', 12).then(console.log)"
```

---

## Verification Checklist

After deployment, verify:

- [ ] `https://panama.yourdomain.com/health` returns `{"status":"ok","db":"ok"}`
- [ ] Login works with admin credentials
- [ ] Data loads for existing home
- [ ] `pm2 status` shows `online`
- [ ] `pm2 logs panama --lines 20` shows no errors
- [ ] SSL certificate valid (`curl -vI https://panama.yourdomain.com 2>&1 | grep "SSL certificate"`)
- [ ] Backup script runs: `./scripts/backup-db.sh`
