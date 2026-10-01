// Zero-dependency static server for Aura. Node >= 18.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = 'localhost';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const NOT_FOUND_PAGE = `<!doctype html><meta charset="utf-8"><title>Not found</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05040a;color:#f5f3ff;font-family:system-ui,sans-serif}
main{text-align:center}h1{font-weight:300;font-size:64px;margin:0;background:linear-gradient(135deg,#a78bfa,#22d3ee,#f472b6);-webkit-background-clip:text;background-clip:text;color:transparent}
p{opacity:.66}a{color:#a78bfa}</style>
<main><h1>404</h1><p>That page drifted away.</p><a href="/">Back to Aura</a></main>`;

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}

function resolveSafe(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = path.normalize(decoded).replace(/^([/\\])+/, '');
  const full = path.resolve(ROOT, rel);
  const inside = full === ROOT || full.startsWith(ROOT + path.sep);
  return inside ? full : null;
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'Method not allowed');
  }
  const { pathname } = new URL(req.url, `http://${HOST}`);
  let file = resolveSafe(pathname === '/' ? '/index.html' : pathname);
  if (!file) return send(res, 403, 'Forbidden');

  try {
    let info = await stat(file);
    if (info.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await stat(file);
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    send(res, 404, NOT_FOUND_PAGE, MIME['.html']);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.\n`);
    console.error('  Stop the other process, or pick another port:');
    console.error('    PORT=5174 npm start        (PowerShell: $env:PORT=5174; npm start)');
    console.error(`  If you use Google Calendar, add http://localhost:5174 to your OAuth\n  "Authorized JavaScript origins" as well.\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`
  aura  study timer

  Local:  ${url}

  Google Calendar note: this exact origin must be listed under
  Google Cloud Console > Credentials > OAuth client > "Authorized JavaScript origins":
    ${url}

  Press Ctrl+C to stop.
`);
});
