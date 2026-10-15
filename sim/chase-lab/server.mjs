import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('./dist/', import.meta.url));
const port = Number(process.env.CHASE_LAB_PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
http.createServer(async (req, res) => {
  try {
    if (req.url === '/__chase_lab_health' && ['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ app: 'lillia-chase-lab', root: fileURLToPath(new URL('.', import.meta.url)) })); return;
    }
    const url = new URL(req.url, 'http://localhost'), name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(root, '.' + name), relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403); res.end(); return; }
    const body = await readFile(target); res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Chase Lab: http://127.0.0.1:${port}`));
