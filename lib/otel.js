/**
 * lib/otel.js — Comprehensive OpenTelemetry OTLP Engine for Vasool
 * 
 * Implements OpenTelemetry (OTel) Distributed Tracing and Metrics over native OTLP HTTP/JSON:
 * - Traces: /v1/traces
 * - Metrics: /v1/metrics
 * 
 * Supports W3C TraceContext propagation (traceparent), HTTP auto-instrumentation,
 * database / algorithm span tracking, and batch flushing.
 */

const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '';
const OTLP_USER_ID = process.env.GRAFANA_OTLP_USER_ID || '';
const GRAFANA_TOKEN = process.env.GRAFANA_CLOUD_TOKEN || '';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'vasool';
const SERVICE_VERSION = '2.0.0';
const ENVIRONMENT = process.env.NODE_ENV || (process.env.VERCEL ? 'production' : 'development');

// Internal Buffers
const spanQueue = [];
const metricQueue = [];
let flushTimeout = null;

function generateTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

function parseTraceParent(header) {
  if (!header || typeof header !== 'string') return null;
  const parts = header.trim().split('-');
  if (parts.length >= 4 && parts[0] === '00' && parts[1].length === 32 && parts[2].length === 16) {
    return {
      version: parts[0],
      traceId: parts[1],
      parentSpanId: parts[2],
      traceFlags: parts[3]
    };
  }
  return null;
}

function formatTraceParent(traceId, spanId) {
  return `00-${traceId}-${spanId}-01`;
}

function convertAttributes(attrs = {}) {
  const result = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      result.push({ key, value: { stringValue: value } });
    } else if (typeof value === 'boolean') {
      result.push({ key, value: { boolValue: value } });
    } else if (Number.isInteger(value)) {
      result.push({ key, value: { intValue: value } });
    } else if (typeof value === 'number') {
      result.push({ key, value: { doubleValue: value } });
    } else {
      result.push({ key, value: { stringValue: JSON.stringify(value) } });
    }
  }
  return result;
}

class Span {
  constructor(name, options = {}) {
    this.name = name;
    this.traceId = options.traceId || generateTraceId();
    this.spanId = generateSpanId();
    this.parentSpanId = options.parentSpanId || null;
    this.kind = options.kind || 1; // 1 = SPAN_KIND_INTERNAL, 2 = SERVER, 3 = CLIENT
    this.startTimeUnixNano = (BigInt(Date.now()) * 1000000n).toString();
    this.endTimeUnixNano = null;
    this.attributes = { ...(options.attributes || {}) };
    this.events = [];
    this.status = { code: 1 }; // 1 = UNSET, 2 = OK, 3 = ERROR
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(obj = {}) {
    Object.assign(this.attributes, obj);
    return this;
  }

  addEvent(name, attributes = {}) {
    this.events.push({
      timeUnixNano: (BigInt(Date.now()) * 1000000n).toString(),
      name,
      attributes: convertAttributes(attributes)
    });
    return this;
  }

  recordException(err) {
    this.status = { code: 3, message: err.message || 'Unknown error' };
    this.addEvent('exception', {
      'exception.type': err.name || 'Error',
      'exception.message': err.message || '',
      'exception.stacktrace': err.stack || ''
    });
    return this;
  }

  setStatus(code, message = '') {
    // code: 'OK' | 'ERROR' | 'UNSET'
    const codeMap = { UNSET: 1, OK: 2, ERROR: 3 };
    this.status = {
      code: codeMap[code] || 1,
      message
    };
    return this;
  }

  end() {
    this.endTimeUnixNano = (BigInt(Date.now()) * 1000000n).toString();
    enqueueSpan(this);
    return this;
  }

  toOtlp() {
    const spanObj = {
      traceId: this.traceId,
      spanId: this.spanId,
      name: this.name,
      kind: this.kind,
      startTimeUnixNano: this.startTimeUnixNano,
      endTimeUnixNano: this.endTimeUnixNano || (BigInt(Date.now()) * 1000000n).toString(),
      attributes: convertAttributes(this.attributes),
      status: this.status
    };
    if (this.parentSpanId) {
      spanObj.parentSpanId = this.parentSpanId;
    }
    if (this.events.length > 0) {
      spanObj.events = this.events;
    }
    return spanObj;
  }
}

function enqueueSpan(span) {
  spanQueue.push(span.toOtlp());
  if (spanQueue.length >= 10) {
    flushSpans();
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (flushTimeout) return;
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    flushAll();
  }, 2000);
}

function sendOtlpPayload(path, payload) {
  if (!GRAFANA_TOKEN) return Promise.resolve(false);

  return new Promise((resolve) => {
    try {
      const baseUrl = OTLP_ENDPOINT.replace(/\/+$/, '');
      const targetUrl = new URL(`${baseUrl}${path}`);
      const auth = Buffer.from(`${OTLP_USER_ID}:${GRAFANA_TOKEN}`).toString('base64');
      const body = JSON.stringify(payload);

      const req = https.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port || 443,
          path: targetUrl.pathname + targetUrl.search,
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: 4000
        },
        (res) => {
          res.resume();
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        }
      );

      req.on('error', (err) => {
        if (process.env.DEBUG_OTEL) {
          console.warn('[OTel Dispatch Error]:', err.message);
        }
        resolve(false);
      });

      req.write(body);
      req.end();
    } catch (err) {
      if (process.env.DEBUG_OTEL) {
        console.warn('[OTel Config Error]:', err.message);
      }
      resolve(false);
    }
  });
}

function flushSpans() {
  if (spanQueue.length === 0) return Promise.resolve();
  const batch = spanQueue.splice(0, spanQueue.length);

  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: convertAttributes({
            'service.name': SERVICE_NAME,
            'service.version': SERVICE_VERSION,
            'deployment.environment': ENVIRONMENT,
            'host.runtime': 'Node.js ' + process.version,
            'telemetry.sdk.name': 'vasool-otel-native',
            'telemetry.sdk.language': 'nodejs'
          })
        },
        scopeSpans: [
          {
            scope: { name: 'vasool-tracer', version: SERVICE_VERSION },
            spans: batch
          }
        ]
      }
    ]
  };

  return sendOtlpPayload('/v1/traces', payload);
}

function flushMetrics() {
  if (metricQueue.length === 0) return Promise.resolve();
  const batch = metricQueue.splice(0, metricQueue.length);

  const payload = {
    resourceMetrics: [
      {
        resource: {
          attributes: convertAttributes({
            'service.name': SERVICE_NAME,
            'service.version': SERVICE_VERSION,
            'deployment.environment': ENVIRONMENT
          })
        },
        scopeMetrics: [
          {
            scope: { name: 'vasool-metrics', version: SERVICE_VERSION },
            metrics: batch
          }
        ]
      }
    ]
  };

  return sendOtlpPayload('/v1/metrics', payload);
}

function flushAll() {
  return Promise.all([flushSpans(), flushMetrics()]);
}

// =============================================================================
// METRICS ENGINE
// =============================================================================
const otelMetrics = {
  /**
   * Records a counter event (monotonic sum)
   */
  counter(name, value = 1, attributes = {}, description = '') {
    const nowNs = (BigInt(Date.now()) * 1000000n).toString();
    metricQueue.push({
      name,
      description: description || `Counter metric for ${name}`,
      unit: '1',
      sum: {
        dataPoints: [
          {
            attributes: convertAttributes(attributes),
            startTimeUnixNano: (BigInt(Date.now() - 1000) * 1000000n).toString(),
            timeUnixNano: nowNs,
            asInt: Math.round(value)
          }
        ],
        aggregationTemporality: 2, // DELTA
        isMonotonic: true
      }
    });

    if (metricQueue.length >= 15) {
      flushMetrics();
    } else {
      scheduleFlush();
    }
  },

  /**
   * Records a gauge event
   */
  gauge(name, value, attributes = {}, description = '', unit = '1') {
    const nowNs = (BigInt(Date.now()) * 1000000n).toString();
    metricQueue.push({
      name,
      description: description || `Gauge metric for ${name}`,
      unit,
      gauge: {
        dataPoints: [
          {
            attributes: convertAttributes(attributes),
            timeUnixNano: nowNs,
            asDouble: Number(value)
          }
        ]
      }
    });

    if (metricQueue.length >= 15) {
      flushMetrics();
    } else {
      scheduleFlush();
    }
  },

  /**
   * Records a duration or monetary histogram observation
   */
  histogram(name, value, attributes = {}, description = '', unit = 'ms') {
    const nowNs = (BigInt(Date.now()) * 1000000n).toString();
    metricQueue.push({
      name,
      description: description || `Histogram metric for ${name}`,
      unit,
      histogram: {
        dataPoints: [
          {
            attributes: convertAttributes(attributes),
            startTimeUnixNano: (BigInt(Date.now() - 1000) * 1000000n).toString(),
            timeUnixNano: nowNs,
            count: 1,
            sum: Number(value),
            min: Number(value),
            max: Number(value)
          }
        ],
        aggregationTemporality: 2 // DELTA
      }
    });

    if (metricQueue.length >= 15) {
      flushMetrics();
    } else {
      scheduleFlush();
    }
  }
};

// =============================================================================
// MAIN OTEL INTERFACE & EXPRESS MIDDLEWARE
// =============================================================================
const otel = {
  startSpan(name, options = {}) {
    return new Span(name, options);
  },

  async trace(name, fn, options = {}) {
    const span = new Span(name, options);
    try {
      const result = await fn(span);
      span.setStatus('OK');
      span.end();
      return result;
    } catch (err) {
      span.recordException(err);
      span.end();
      throw err;
    }
  },

  metrics: otelMetrics,
  flush: flushAll,

  parseTraceParent,
  formatTraceParent,

  /**
   * Express HTTP middleware for OpenTelemetry request tracing & metrics
   */
  middleware() {
    return (req, res, next) => {
      const startTime = Date.now();
      const parent = parseTraceParent(req.headers['traceparent'] || req.headers['trace-parent']);
      const traceId = parent ? parent.traceId : generateTraceId();
      const parentSpanId = parent ? parent.parentSpanId : null;

      const span = new Span(`HTTP ${req.method} ${req.route ? req.route.path : req.path}`, {
        traceId,
        parentSpanId,
        kind: 2, // SERVER
        attributes: {
          'http.method': req.method,
          'http.target': req.originalUrl,
          'http.route': req.path,
          'http.client_ip': req.ip || req.headers['x-forwarded-for'] || '',
          'http.user_agent': req.headers['user-agent'] || '',
          'net.host.name': req.hostname
        }
      });

      req.otelSpan = span;
      req.traceId = traceId;
      req.spanId = span.spanId;
      req.traceParent = formatTraceParent(traceId, span.spanId);

      // Expose traceparent header to clients (allows browser to correlate frontend & backend traces)
      res.setHeader('Access-Control-Expose-Headers', 'traceparent');
      res.setHeader('traceparent', req.traceParent);

      res.on('finish', () => {
        const durationMs = Date.now() - startTime;
        const statusCode = res.statusCode;
        const statusClass = `${Math.floor(statusCode / 100)}xx`;

        span.setAttribute('http.status_code', statusCode);
        span.setAttribute('http.status_class', statusClass);
        span.setAttribute('http.duration_ms', durationMs);

        if (req.user && req.user.email) {
          span.setAttribute('enduser.id', req.user.email);
          span.setAttribute('enduser.role', req.user.role || 'user');
        }

        if (statusCode >= 400) {
          span.setStatus('ERROR', `HTTP status ${statusCode}`);
        } else {
          span.setStatus('OK');
        }

        span.end();

        // Increment standard HTTP metrics
        const metricRoute = (req.baseUrl || '') + (req.route ? req.route.path : req.path);
        otelMetrics.counter('vasool_http_requests_total', 1, {
          method: req.method,
          route: metricRoute,
          status_code: String(statusCode),
          status_class: statusClass
        });

        otelMetrics.histogram('vasool_http_request_duration_ms', durationMs, {
          method: req.method,
          route: metricRoute,
          status_class: statusClass
        });
      });

      next();
    };
  }
};

module.exports = otel;
