import client from 'prom-client';
import { pool } from './db.js';
import { countRetryQueueSize } from './repositories/webhookRepo.js';

const registry = new client.Registry();

client.collectDefaultMetrics({
  register: registry,
  prefix: 'panama_',
});

const httpRequestsTotal = new client.Counter({
  name: 'panama_http_requests_total',
  help: 'Total HTTP requests handled by the server',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});

const httpRequestDurationMs = new client.Histogram({
  name: 'panama_http_request_duration_ms',
  help: 'HTTP request duration in milliseconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 3000, 10000],
  registers: [registry],
});

const dbPoolTotalGauge = new client.Gauge({
  name: 'panama_db_pool_total',
  help: 'Current total PostgreSQL pool connections',
  registers: [registry],
});

const dbPoolIdleGauge = new client.Gauge({
  name: 'panama_db_pool_idle',
  help: 'Current idle PostgreSQL pool connections',
  registers: [registry],
});

const dbPoolWaitingGauge = new client.Gauge({
  name: 'panama_db_pool_waiting',
  help: 'Current waiting PostgreSQL pool clients',
  registers: [registry],
});

const webhookRetryQueueGauge = new client.Gauge({
  name: 'panama_webhook_retry_queue_size',
  help: 'Webhook deliveries waiting for retry or currently in progress',
  registers: [registry],
});

function metricRouteFor(req) {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : req.path;
  return `${req.baseUrl || ''}${routePath || ''}` || 'unknown';
}

export function recordHttpRequestMetrics(req, res, durationMs) {
  const labels = {
    method: req.method,
    route: metricRouteFor(req),
    status: String(res.statusCode),
  };
  httpRequestsTotal.inc(labels);
  httpRequestDurationMs.observe(labels, durationMs);
}

export async function renderMetrics() {
  dbPoolTotalGauge.set(pool.totalCount);
  dbPoolIdleGauge.set(pool.idleCount);
  dbPoolWaitingGauge.set(pool.waitingCount);
  webhookRetryQueueGauge.set(await countRetryQueueSize());
  return registry.metrics();
}

export function metricsContentType() {
  return registry.contentType;
}
