require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const logger = require('./lib/logger');
const otel = require('./lib/otel');
const { authRouter } = require('./routes/auth');
const { splitsRouter } = require('./routes/splits');
const { adminRouter } = require('./routes/admin');
const { connectToDatabase } = require('./lib/mongodb');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(otel.middleware());
app.use(logger.requestMiddleware());
app.use(express.static(path.join(__dirname, 'public')));

// POST /api/logs/client — Receive frontend logs & errors to stream into Grafana Loki
app.post('/api/logs/client', (req, res) => {
  const { level = 'info', message = 'Client Event', meta = {} } = req.body || {};
  logger.client(level, message, { ...meta, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.status(204).end();
});

// POST /api/telemetry/rum — Receive frontend OpenTelemetry RUM spans, metrics & user interactions
app.post('/api/telemetry/rum', (req, res) => {
  const { spans = [], metrics = [] } = req.body || {};
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '';
  const userAgent = req.headers['user-agent'] || '';

  // Ingest RUM spans into OpenTelemetry trace pipeline
  spans.forEach((s) => {
    const span = otel.startSpan(`RUM ${s.name || 'User Event'}`, {
      traceId: s.traceId,
      parentSpanId: s.parentSpanId,
      kind: 3, // CLIENT
      attributes: {
        ...(s.attributes || {}),
        'client.ip': clientIp,
        'client.user_agent': userAgent,
        'service.name': 'vasool-frontend-rum'
      }
    });
    if (s.durationMs) {
      span.setAttribute('client.duration_ms', s.durationMs);
    }
    if (s.status === 'ERROR') {
      span.setStatus('ERROR', s.error || 'Client Error');
    } else {
      span.setStatus('OK');
    }
    span.end();
  });

  // Ingest RUM metrics into OpenTelemetry metrics pipeline
  metrics.forEach((m) => {
    if (m.type === 'histogram') {
      otel.metrics.histogram(m.name, m.value, { ...(m.attributes || {}), service: 'frontend' });
    } else {
      otel.metrics.counter(m.name, m.value || 1, { ...(m.attributes || {}), service: 'frontend' });
    }
  });

  res.status(204).end();
});

// Health check & Infisical/MongoDB status endpoint
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    const uri = process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('your_mongodb')
      ? process.env.MONGODB_URI
      : process.env.MONGO_URI;
    if (uri) {
      await connectToDatabase();
      dbStatus = 'connected';
    } else {
      dbStatus = 'missing_mongodb_uri';
    }
  } catch (err) {
    dbStatus = 'error: ' + err.message;
  }

  res.status(200).json({
    service: 'vasool',
    status: 'ok',
    version: '2.0.0',
    mongodb: dbStatus,
    googleOAuthConfigured: Boolean(process.env.VASOOL_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID),
    infisicalConfigured: Boolean(process.env.MONGO_URI || process.env.MONGODB_URI),
    grafanaLokiConfigured: Boolean(process.env.GRAFANA_CLOUD_TOKEN),
    openTelemetryConfigured: Boolean(process.env.GRAFANA_CLOUD_TOKEN),
    timestamp: new Date().toISOString()
  });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', splitsRouter);

// Global express error handler with Grafana Loki streaming
app.use((err, req, res, next) => {
  logger.error(`[Unhandled Exception] ${err.message}`, err, { url: req.originalUrl, method: req.method });
  res.status(500).json({ error: 'Internal Server Error' });
});

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  connectToDatabase()
    .then(() => {
      logger.info('[Vasool Splits] Connected to MongoDB Atlas');
    })
    .catch((err) => {
      logger.warn('[Vasool Splits] MongoDB connection deferred or offline:', err.message);
    })
    .finally(() => {
      app.listen(PORT, '0.0.0.0', () => {
        logger.info(`[Vasool Splits] Server listening on http://0.0.0.0:${PORT}`);
      });
    });
}

module.exports = app;
