'use strict';

const http = require('node:http');
const { scrubMessages } = require('./scrubber');

const PORT = parseInt(process.env.PII_PROXY_PORT, 10) || 18790;
const HOST = '127.0.0.1';
const TARGET_BASE = (process.env.MINIMAX_REAL_BASE_URL || 'https://api.minimax.chat').replace(/\/+$/, '');

function timestamp() {
  return new Date().toISOString();
}

function log(msg) {
  process.stdout.write(`[${timestamp()}] ${msg}\n`);
}

/**
 * Build the forwarding URL from the incoming request path.
 */
function buildTargetUrl(path) {
  return `${TARGET_BASE}${path}`;
}

/**
 * Build headers to forward. Copies all incoming headers except hop-by-hop ones.
 * Updates host to match the target.
 */
function buildForwardHeaders(incomingHeaders) {
  const headers = {};
  const skipHeaders = new Set([
    'host',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'te',
    'trailer',
    'upgrade',
  ]);

  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (!skipHeaders.has(key.toLowerCase())) {
      headers[key] = value;
    }
  }

  // Set the host header to match the target
  try {
    const url = new URL(TARGET_BASE);
    headers['host'] = url.host;
  } catch {
    // If TARGET_BASE is malformed, skip host rewrite
  }

  return headers;
}

/**
 * Read the full request body as a Buffer.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Handle the /health endpoint.
 */
function handleHealth(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', scrubber: 'active' }));
}

/**
 * Forward a request to the target, scrubbing PII from POST bodies.
 */
async function handleProxy(req, res) {
  const method = req.method;
  const path = req.url;
  let scrubCount = 0;
  let body;

  try {
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const rawBody = await readBody(req);

      if (rawBody.length > 0) {
        try {
          const parsed = JSON.parse(rawBody.toString('utf8'));

          // Scrub messages if present
          if (parsed.messages && Array.isArray(parsed.messages)) {
            const result = scrubMessages(parsed.messages);
            parsed.messages = result.messages;
            scrubCount = result.scrubCount;
          }

          body = JSON.stringify(parsed);
        } catch {
          // Not valid JSON — forward the raw body as-is
          body = rawBody;
        }
      }
    } else if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && method !== 'DELETE') {
      // For unknown methods with potential bodies, read and forward raw
      const rawBody = await readBody(req);
      if (rawBody.length > 0) {
        body = rawBody;
      }
    }

    log(`${method} ${path} — scrubbed ${scrubCount} PII item${scrubCount !== 1 ? 's' : ''}`);

    const targetUrl = buildTargetUrl(path);
    const forwardHeaders = buildForwardHeaders(req.headers);

    // Set correct content-length if we re-serialized the body
    if (body !== undefined) {
      const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
      forwardHeaders['content-length'] = String(bodyBuffer.length);
    }

    const fetchOptions = {
      method,
      headers: forwardHeaders,
      // Prevent fetch from following redirects — let the client handle them
      redirect: 'manual',
    };

    if (body !== undefined) {
      fetchOptions.body = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    }

    let upstream;
    try {
      upstream = await fetch(targetUrl, fetchOptions);
    } catch (err) {
      log(`Upstream error: ${err.code || err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad_gateway', message: 'Failed to reach upstream API' }));
      return;
    }

    // Build response headers
    const responseHeaders = {};
    for (const [key, value] of upstream.headers.entries()) {
      // Skip hop-by-hop headers from the upstream response
      const lower = key.toLowerCase();
      if (lower === 'transfer-encoding' || lower === 'connection') continue;
      responseHeaders[key] = value;
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isStream = contentType.includes('text/event-stream');

    if (isStream && upstream.body) {
      // Streaming SSE response — pipe it through
      // Set transfer-encoding: chunked for streaming
      responseHeaders['transfer-encoding'] = 'chunked';
      res.writeHead(upstream.status, responseHeaders);

      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const ok = res.write(value);
          if (!ok) {
            // Backpressure: wait for drain
            await new Promise((resolve) => res.once('drain', resolve));
          }
        }
      } catch (err) {
        log(`Stream error: ${err.message}`);
      } finally {
        res.end();
      }
    } else {
      // Non-streaming response — buffer and forward
      let responseBody;
      try {
        responseBody = Buffer.from(await upstream.arrayBuffer());
      } catch {
        responseBody = Buffer.alloc(0);
      }

      responseHeaders['content-length'] = String(responseBody.length);
      res.writeHead(upstream.status, responseHeaders);
      res.end(responseBody);
    }
  } catch (err) {
    log(`Internal error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal_error', message: 'Proxy encountered an internal error' }));
    }
  }
}

const server = http.createServer((req, res) => {
  // Health check — do not forward
  if (req.method === 'GET' && req.url === '/health') {
    handleHealth(res);
    return;
  }

  handleProxy(req, res);
});

server.listen(PORT, HOST, () => {
  log(`PII scrub proxy listening on ${HOST}:${PORT}`);
  log(`Forwarding to: ${TARGET_BASE}`);
});

// Graceful shutdown
function shutdown() {
  log('Shutting down...');
  server.close(() => process.exit(0));
  // Force exit after 5s if connections don't close
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
