import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { loadEconomy, makeDraft, mods } from './economy.mjs';
import { refreshMarket } from './market.mjs';
import { buildMetadata, buildPackage, panel, releaseDirectory, root } from './packages.mjs';

const run = promisify(execFile);
const host = '127.0.0.1';
const port = Number(process.env.PANEL_PORT ?? 4173);
const origin = `http://${host}:${port}`;
const busy = new Set();
const packer = join(panel, 'scs_packer.exe');
const pages = {
  '/': ['index.html', 'text/html'],
  '/panel.css': ['panel.css', 'text/css'],
  '/panel.js': ['panel.js', 'text/javascript']
};

async function gameDirectory(mod) {
  const custom = mod.currency === 'USD' ? process.env.ATS_MOD_DIR : process.env.ETS2_MOD_DIR;
  if (custom) {
    if (!isAbsolute(custom)) throw new Error('Путь к папке mod должен быть абсолютным.');
    return custom;
  }
  const { stdout } = await run('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')"
  ], { windowsHide: true });
  const documents = stdout.trim();
  if (!isAbsolute(documents)) throw new Error('Windows не вернула путь к папке «Документы».');
  return join(documents, mod.game, 'mod');
}

async function requestBody(request) {
  if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
    throw new Error('Действия доступны только из локального пульта.');
  }
  let body = '';
  for await (const chunk of request.setEncoding('utf8')) {
    body += chunk;
    if (body.length > 524_288) throw new Error('Черновик слишком большой.');
  }
  return JSON.parse(body);
}

function reply(response, status, value, type = 'application/json') {
  response.writeHead(status, {
    'Content-Type': type + '; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(type === 'application/json' ? JSON.stringify(value) : value);
}

createServer(async (request, response) => {
  try {
    if (request.headers.host !== `${host}:${port}`) return reply(response, 403, { error: 'Откройте пульт по локальному адресу.' });
    if (request.method === 'GET' && Object.hasOwn(pages, request.url)) {
      const [file, type] = pages[request.url];
      return reply(response, 200, await readFile(join(panel, file)), type);
    }
    const [, id, action] = request.url.match(/^\/api\/mods\/([a-z0-9-]+)(?:\/(market|preview|test|release))?$/) ?? [];
    if (!Object.hasOwn(mods, id)) return reply(response, 404, { error: 'Раздел не найден.' });
    if (busy.has(id)) return reply(response, 409, { error: 'Сборка этого мода уже запущена.' });
    if (!action && request.method === 'GET') {
      const economy = await loadEconomy(root, id);
      const { mod, fields, documents, revision, previousRevision, dataRevision, ferrySettings, rub, version, gameVersion } = economy;
      return reply(response, 200, { mod, fields, documents, revision, previousRevision, dataRevision, ferrySettings, rub, version, gameVersion,
        destination: await gameDirectory(mod).catch(() => null), releaseDirectory });
    }
    if (!action || request.method !== 'POST') return reply(response, 405, { error: 'Метод не поддерживается.' });
    const body = await requestBody(request);
    const economy = await loadEconomy(root, id);
    if (action === 'market') {
      if (body?.revision !== economy.revision || body.dataRevision !== economy.dataRevision) {
        throw new Error('Исходные файлы изменились. Перезагрузите мод в пульте.');
      }
      return reply(response, 200, await refreshMarket(economy, body.mode));
    }
    const draft = makeDraft(economy, body);
    const metadata = buildMetadata(economy, body);
    if (action === 'preview') return reply(response, 200, { changes: draft.changes, skippedFerries: draft.skippedFerries });
    if (busy.has(id)) return reply(response, 409, { error: 'Сборка этого мода уже запущена.' });
    busy.add(id);
    try {
      const testDestination = action === 'test' ? await gameDirectory(economy.mod) : undefined;
      const result = await buildPackage(id, economy, draft, metadata, testDestination);
      return reply(response, 200, { ...result, skippedFerries: draft.skippedFerries });
    } finally {
      busy.delete(id);
    }
  } catch (error) {
    reply(response, 400, { error: error.message });
  }
}).listen(port, host, async () => {
  console.log(`Пульт Realistic Economy: ${origin}`);
  await access(packer).catch(() => console.warn('В tools/panel отсутствует scs_packer.exe.'));
});
