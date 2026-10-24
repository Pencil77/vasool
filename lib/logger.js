/**
 * lib/logger.js — Central Observability & Grafana Cloud Loki Log Shipper for Vasool
 * 
 * Streams structured application, API, and client logs to Grafana Cloud Loki:
 * Endpoint: https://logs-prod-028.grafana.net/loki/api/v1/push
 * Tenant / User ID: 1794489
 * Authenticated via GRAFANA_CLOUD_TOKEN from Infisical
 */

const https = require('https');
const { URL } = require('url');

const LOKI_URL = process.env.LOKI_URL || 'https://logs-prod-028.grafana.net/loki/api/v1/push';
const LOKI_USER_ID = process.env.LOKI_USER_ID || '1794489';
const LOKI_TOKEN = process.env.GRAFANA_CLOUD_TOKEN || '';
const ENV = process.env.NODE_ENV || (process.env.VERCEL ? 'production' : 'development');

/**
 * Sends a batch of log entries to Grafana Loki via HTTP Basic Auth.
 * Non-blocking, fails silently to local console if Loki is unavailable.
 */
function pushToLoki(streamLabels, logLines) {
  if (!LOKI_TOKEN) {
    return; // Token not configured (e.g. offline dev), skip remote push
  }

  try {
    const parsedUrl = new URL(LOKI_URL);
    const auth = Buffer.from(`${LOKI_USER_ID}:${LOKI_TOKEN}`).toString('base64');

    const streams = [
      {
        stream: {
          app: 'vasool',
          env: ENV,
          ...streamLabels
        },
        values: logLines.map((entry) => [
          entry.timestampNs || (BigInt(Date.now()) * 1000000n).toString(),
          typeof entry.message === 'string' ? entry.message : JSON.stringify(entry.message)
        ])
      }
    ];

    const body = JSON.stringify({ streams });

    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 4000
      },
      (res) => {
        // Loki returns 204 No Content on success
        res.resume();
      }
    );

    req.on('error', (err) => {
      // Avoid recursive crash; log once to console
      if (process.env.DEBUG_LOKI) {
        console.warn('[Loki Logger Error]:', err.message);
      }
    });

    req.write(body);
    req.end();
  } catch (err) {
    if (process.env.DEBUG_LOKI) {
      console.warn('[Loki Dispatch Error]:', err.message);
    }
  }
}

function formatMessage(msg, meta) {
  const ts = new Date().toISOString();
  if (!meta) return `[${ts}] ${msg}`;
  return `[${ts}] ${msg} | ${JSON.stringify(meta)}`;
}

const logger = {
  info(message, meta = null, extraLabels = {}) {
    const formatted = formatMessage(message, meta);
    console.log(formatted);
    pushToLoki({ level: 'info', service: 'backend', ...extraLabels }, [
      { message: formatted }
    ]);
  },

  warn(message, meta = null, extraLabels = {}) {
    const formatted = formatMessage(message, meta);
    console.warn(formatted);
    pushToLoki({ level: 'warn', service: 'backend', ...extraLabels }, [
      { message: formatted }
    ]);
  },

  error(message, errorOrMeta = null, extraLabels = {}) {
    let metaObj = {};
    if (errorOrMeta instanceof Error) {
      metaObj = {
        name: errorOrMeta.name,
        message: errorOrMeta.message,
        stack: errorOrMeta.stack
      };
    } else if (errorOrMeta) {
      metaObj = errorOrMeta;
    }
    const formatted = formatMessage(message, metaObj);
    console.error(formatted);
    pushToLoki({ level: 'error', service: 'backend', ...extraLabels }, [
      { message: formatted }
    ]);
  },

  /**
   * Logs client-side errors & events received from browser app
   */
  client(level, message, meta = {}) {
    const formatted = `[CLIENT] ${message} | ${JSON.stringify(meta)}`;
    if (level === 'error') console.error(formatted);
    else if (level === 'warn') console.warn(formatted);
    else console.log(formatted);

    pushToLoki({ level: level || 'info', service: 'frontend' }, [
      { message: formatted }
    ]);
  },

  /**
   * Express HTTP request tracing middleware
   */
  requestMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const { method, originalUrl, ip } = req;

      // Ignore asset & favicon polling to reduce log noise
      if (originalUrl.startsWith('/favicon') || originalUrl.includes('.png') || originalUrl.includes('.svg')) {
        return next();
      }

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
        const user = req.user ? req.user.email : 'unauthenticated';

        const summary = `${method} ${originalUrl} -> ${statusCode} (${duration}ms) [${user}]`;
        pushToLoki(
          { level, service: 'api', route: originalUrl.split('?')[0] },
          [{ message: `[HTTP] ${summary} | IP: ${ip}` }]
        );
      });

      next();
    };
  }
};

module.exports = logger;
