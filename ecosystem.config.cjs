/**
 * PM2 process manager configuration.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 restart panama
 *   pm2 stop panama
 *   pm2 logs panama
 *   pm2 monit
 *
 * Production setup:
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 save
 *   pm2 startup
 */

module.exports = {
  apps: [
    {
      name: 'panama',
      script: 'server.js',
      instances: 4,              // Cluster mode - 4 workers behind PM2's internal balancer.
      // Keep instances * DB_POOL_MAX within PostgreSQL connection headroom.
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,              // Nodemon handles dev; PM2 handles production.
      node_args: '--max-old-space-size=768',
      max_memory_restart: '1G',
      min_uptime: '10s',         // Consider crash if it dies within 10s of start.
      max_restarts: 10,          // Stop restart loop after 10 rapid failures.

      // Logging
      error_file: './logs/panama-error.log',
      out_file: './logs/panama-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Log rotation (requires pm2-logrotate module)
      // pm2 install pm2-logrotate
      // pm2 set pm2-logrotate:max_size 10M
      // pm2 set pm2-logrotate:retain 30
      // pm2 set pm2-logrotate:compress true

      // Graceful shutdown
      kill_timeout: 5000,        // Matches server.js 5s force-exit timeout.
      listen_timeout: 10000,
      shutdown_with_message: true,

      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
