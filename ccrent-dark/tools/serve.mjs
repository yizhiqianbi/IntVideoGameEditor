#!/usr/bin/env node
/**
 * Tiny zero-dependency static server for previewing the replica.
 *   node tools/serve.mjs [port]
 * Defaults to http://127.0.0.1:8899
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8899);

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
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    let filePath = path.normalize(path.join(root, pathname));
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    // clean URLs: /pricing → pricing.html (mirrors Cloudflare Pages behaviour)
    if (!fs.existsSync(filePath) && !path.extname(filePath)) {
      const htmlPath = filePath + '.html';
      if (fs.existsSync(htmlPath)) filePath = htmlPath;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>404</title>` +
          `<body style="background:#08090b;color:#eee;font:16px/1.6 system-ui;display:grid;place-items:center;height:100vh;margin:0">` +
          `<div style="text-align:center"><p style="font-size:44px;margin:0">404</p>` +
          `<p style="color:#9b9fab">复刻站没有这个页面，<a style="color:#8aa4ff" href="/">回到首页</a></p></div>`
      );
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500).end('Internal error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`CCRent dark replica → http://127.0.0.1:${port}`);
});
