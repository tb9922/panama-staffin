# Panama Operations Alerting

Production must have an external monitor that is outside the VPS. The app now
supports a Healthchecks.io-style ping via `HEALTHCHECK_URL`; worker 0 pings it
every `HEALTHCHECK_PING_INTERVAL_MS` milliseconds after confirming Postgres can
answer `SELECT 1`.

Minimum production setup:

1. Create an external check with a 2 minute grace window.
2. Set `HEALTHCHECK_URL=https://hc-ping.com/<uuid>` in `/var/www/panama-staffing/.env`.
3. Set `METRICS_TOKEN` and scrape `/metrics` from a locked-down Prometheus job.
4. Alert on:
   - missing healthcheck ping for 2 minutes
   - `/readiness` returning non-2xx
   - `panama_db_pool_waiting > 0` for 5 minutes
   - webhook retry queue growing for 15 minutes
   - backup verification failure

The in-app ping is intentionally not the only control: if the whole VPS dies,
the external service still alerts because the ping stops.
