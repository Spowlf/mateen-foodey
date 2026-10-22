// Runs the whole thing on your Mac with no Cloudflare account and no dependencies:
//   the app on http://localhost:3000 and the Worker on http://localhost:8787,
//   with the data in .dev.db (SQLite; git ignores it).
// In the app's Settings use the address http://localhost:8787 and the token printed below.
// Sentence logging and USDA search need ANTHROPIC_API_KEY and USDA_API_KEY in .dev.vars (git ignores it).
// CoFID search needs the import once: node scripts/import-cofid.js <file.xlsx> --apply --local
//
//   npm run dev
//
// It listens on this Mac only; HOST=0.0.0.0 opens it to your network.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteD1 } from './sqlite-d1.js';
import { handle } from '../worker/src/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP_PORT = Number(process.env.APP_PORT ?? 3000);
const API_PORT = Number(process.env.API_PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

function devVars() {
  const path = join(ROOT, '.dev.vars');
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n')
    .map((l) => /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
}

const vars = devVars();
const env = {
  DB: sqliteD1(process.env.DEV_DB ?? join(ROOT, '.dev.db')),
  API_TOKEN: vars.API_TOKEN ?? 'dev-token',
  ANTHROPIC_API_KEY: vars.ANTHROPIC_API_KEY,
  USDA_API_KEY: vars.USDA_API_KEY,
  ALLOWED_ORIGIN: `http://localhost:${APP_PORT}`,
};

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { path = null; }
  const file = path && normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (!file || !file.startsWith(ROOT) || /[/\\]\.|[/\\](worker|tests|scripts|reference)[/\\]/.test(file.slice(ROOT.length - 1))) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(APP_PORT, HOST, () => console.log(`App:    http://localhost:${APP_PORT}`));

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${API_PORT}${req.url}`, {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handle(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(API_PORT, HOST, () => console.log(`Worker: http://localhost:${API_PORT}  (token: ${env.API_TOKEN})`));
