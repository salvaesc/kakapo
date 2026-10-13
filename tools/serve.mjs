// Zero-dependency static server for local development.
//   node tools/serve.mjs              → http://localhost:8080 (localhost is a secure context, mic works)
//   PORT=3000 node tools/serve.mjs
//   HTTPS_KEY=key.pem HTTPS_CERT=cert.pem node tools/serve.mjs   → https on your LAN for phone testing
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.wav': 'audio/wav',
};

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(root, '.' + p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

const useHttps = process.env.HTTPS_KEY && process.env.HTTPS_CERT;
const server = useHttps
  ? https.createServer({ key: fs.readFileSync(process.env.HTTPS_KEY), cert: fs.readFileSync(process.env.HTTPS_CERT) }, handler)
  : http.createServer(handler);

server.listen(port, '0.0.0.0', () => {
  const proto = useHttps ? 'https' : 'http';
  console.log(`KAKAPO running at ${proto}://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: ${proto}://${a.address}:${port}${useHttps ? '' : '  (mic needs HTTPS here — see README)'}`);
    }
  }
});
