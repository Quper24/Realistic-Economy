import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadEconomy, makeDraft, mods, replaceField } from './economy.mjs';

const run = promisify(execFile);
const panel = dirname(fileURLToPath(import.meta.url));
const root = join(panel, '..', '..');
const work = join(root, '.panel-work');
const host = '127.0.0.1';
const port = Number(process.env.PANEL_PORT ?? 4173);
const origin = `http://${host}:${port}`;
const busy = new Set();
const packer = join(panel, 'scs_packer.exe');
const assets = ['def', 'unit', 'material', 'ui', 'vehicle', 'locale'];
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

async function packTest(id, economy, draft) {
  const destination = await gameDirectory(economy.mod);
  if (!(await stat(destination).catch(() => null))?.isDirectory()) {
    throw new Error(`Папка игры не найдена: ${destination}`);
  }
  await mkdir(work, { recursive: true });
  const resolvedRoot = await realpath(root);
  if (await realpath(work) !== join(resolvedRoot, '.panel-work')) throw new Error('Неожиданный путь рабочей папки.');
  const temporary = await mkdtemp(join(work, 'test-'));
  const filename = `quper-${id}-test.scs`;
  const target = join(destination, filename);
  const incoming = join(destination, `.${filename}.${randomUUID()}.tmp`);
  try {
    const stage = join(temporary, 'stage');
    const archive = join(temporary, filename);
    const source = join(root, economy.mod.dir);
    await mkdir(stage);
    for (const name of assets) {
      const dir = join(source, name);
      if (await stat(dir).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      })) await cp(dir, join(stage, name), { recursive: true });
    }
    for (const [file, contents] of draft.sources) {
      await writeFile(join(stage, file), contents, 'utf8');
    }
    const manifest = await readFile(join(source, 'manifest.sii'), 'utf8');
    const named = replaceField(manifest, 'display_name', raw => raw.replace(/^"/, '"[TEST] '));
    await writeFile(join(stage, 'manifest.sii'), replaceField(named, 'icon', () => '"image.jpg"'), 'utf8');
    await copyFile(join(panel, 'test.jpg'), join(stage, 'image.jpg'));
    await copyFile(join(source, 'description.txt'), join(stage, 'description.txt'));
    try {
      await run(packer, ['create', archive, '-root', stage], { windowsHide: true, timeout: 120_000 });
    } catch (error) {
      throw new Error('SCS Packer: ' + (error.stderr?.trim() || error.stdout?.trim() || error.message));
    }
    const signature = (await readFile(archive)).subarray(0, 4).toString('ascii');
    if (signature !== 'SCS#') throw new Error('SCS Packer не создал корректный заголовок архива.');
    await copyFile(archive, incoming);
    await rename(incoming, target);
    return { path: target, changes: draft.changes };
  } finally {
    await rm(incoming, { force: true }).catch(() => {});
    const resolvedTemp = await realpath(temporary);
    if (dirname(resolvedTemp) === join(resolvedRoot, '.panel-work')) {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

async function requestBody(request) {
  if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
    throw new Error('Действия доступны только из локального пульта.');
  }
  let body = '';
  for await (const chunk of request.setEncoding('utf8')) {
    body += chunk;
    if (body.length > 16_384) throw new Error('Черновик слишком большой.');
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
    const [, id, action] = request.url.match(/^\/api\/mods\/([a-z0-9-]+)(?:\/(preview|test))?$/) ?? [];
    if (!Object.hasOwn(mods, id)) return reply(response, 404, { error: 'Раздел не найден.' });
    if (!action && request.method === 'GET') {
      const economy = await loadEconomy(root, id);
      const { mod, fields, revision, rub } = economy;
      return reply(response, 200, { mod, fields, revision, rub, destination: await gameDirectory(mod) });
    }
    if (!action || request.method !== 'POST') return reply(response, 405, { error: 'Метод не поддерживается.' });
    const body = await requestBody(request);
    const economy = await loadEconomy(root, id);
    const draft = makeDraft(economy, body);
    if (action === 'preview') return reply(response, 200, { changes: draft.changes });
    if (busy.has(id)) return reply(response, 409, { error: 'Тестовая сборка этого мода уже запущена.' });
    busy.add(id);
    try {
      return reply(response, 200, await packTest(id, economy, draft));
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
