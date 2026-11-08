import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { loadEconomy, makeDraft, mods, replaceField } from './economy.mjs';
import { refreshMarket } from './market.mjs';
import { buildMetadata, buildPackage, panel, releaseDirectory, root } from './packages.mjs';
import { profileDraft, profileGroups, readProfileRelease } from './profiles.mjs';

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
    const profile = id?.match(/-(light|hard)$/)?.[1];
    const baseId = profile ? id.slice(0, -profile.length - 1) : id;
    if (!Object.hasOwn(mods, baseId) || (baseId === 'ets2-russia' && profile)) {
      return reply(response, 404, { error: 'Раздел не найден.' });
    }
    if (busy.has(baseId)) return reply(response, 409, { error: 'Сборка этого мода уже запущена.' });
    const body = request.method === 'POST' && action ? await requestBody(request) : null;
    const economy = await loadEconomy(root, baseId);
    if (profile) {
      const profileRelease = await readProfileRelease(root, id);
      const name = profile === 'light' ? 'Light' : 'Hard';
      economy.mod = { ...economy.mod, profile: name, filename: economy.mod.filename.replace(/\.scs$/, `-${name}.scs`) };
      economy.profileRelease = profileRelease;
      economy.profileGroups = profileGroups(economy, profile, profileRelease);
      economy.version = profileRelease?.version ?? economy.version;
      economy.baseGameVersion = economy.gameVersion;
      if (profileRelease?.baseGameVersion === economy.baseGameVersion) economy.gameVersion = profileRelease.gameVersion;
      economy.revision = createHash('sha256').update(JSON.stringify([economy.revision, economy.dataRevision,
        profileRelease?.folder])).digest('hex');
      economy.previousRevision = null;
    }
    if (!action && request.method === 'GET') {
      const { mod, fields, documents, revision, previousRevision, dataRevision, ferrySettings, rub, version, gameVersion } = economy;
      return reply(response, 200, { mod, fields, documents, revision, previousRevision, dataRevision, ferrySettings, rub, version, gameVersion,
        profileGroups: economy.profileGroups, released: Boolean(economy.profileRelease),
        destination: await gameDirectory(mod).catch(() => null), releaseDirectory });
    }
    if (!action || request.method !== 'POST') return reply(response, 405, { error: 'Метод не поддерживается.' });
    if (action === 'market') {
      if (profile) throw new Error('Рыночные данные профиля наследуются из Realistic.');
      if (body?.revision !== economy.revision || body.dataRevision !== economy.dataRevision) {
        throw new Error('Исходные файлы изменились. Перезагрузите мод в пульте.');
      }
      return reply(response, 200, await refreshMarket(economy, body.mode));
    }
    const metadata = buildMetadata(economy, body);
    const draft = profile ? profileDraft(economy, body, replaceField, metadata) : makeDraft(economy, body);
    if (action === 'preview') return reply(response, 200, { changes: draft.changes, skippedFerries: draft.skippedFerries });
    if (busy.has(baseId)) return reply(response, 409, { error: 'Сборка этого мода уже запущена.' });
    busy.add(baseId);
    try {
      const testDestination = action === 'test' ? await gameDirectory(economy.mod) : undefined;
      const result = await buildPackage(id, economy, draft, metadata, testDestination);
      return reply(response, 200, { ...result, skippedFerries: draft.skippedFerries });
    } finally {
      busy.delete(baseId);
    }
  } catch (error) {
    reply(response, 400, { error: error.message });
  }
}).listen(port, host, async () => {
  console.log(`Пульт Realistic Economy: ${origin}`);
  await access(packer).catch(() => console.warn('В tools/panel отсутствует scs_packer.exe.'));
});
