import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    // Serve only public application files. Do not expose source videos, raw frames or dependencies.
    const normalized = path.relative(root, file).split(path.sep).join('/');
    const allowed = ['index.html', 'styles.css', 'app.js', 'favicon.svg'].includes(normalized) || normalized.startsWith('assets/');
    if (!allowed || !file.startsWith(root + path.sep) || !(await stat(file)).isFile()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': relative.startsWith('assets/') ? 'public, max-age=3600' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`ГЛИБШЕ — http://127.0.0.1:${port}`));
