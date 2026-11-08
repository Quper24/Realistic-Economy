import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { editableDefinitions } from './definitions.mjs';

const active = new Map();

function validFile(id, file) {
  return ['manifest.sii', 'description.txt', 'def/economy_data.sii'].includes(file) ||
    editableDefinitions(id).some(item => item.file === file) ||
    /^def\/(?:country|ferry\/connection)\/[^/\\:]+\.s(?:ii|ui)$/i.test(file);
}

async function readSource(root, mod, file) {
  const path = join(root, mod.dir, file);
  if (await realpath(path) !== path) throw new Error(`Неожиданный путь исходника ${file}.`);
  return { path, text: await readFile(path, 'utf8') };
}

function paths(root, id) {
  const work = join(root, '.panel-work');
  return { work, prefix: `release-baseline-${id}--` };
}

async function finish(root, id, mod, pending, work) {
  const saved = await readFile(pending, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (saved === null) return;
  const entries = JSON.parse(saved);
  const files = new Set();
  for (const { file, before, after } of entries) {
    if (!validFile(id, file) || typeof before !== 'string' || typeof after !== 'string' || files.has(file)) {
      throw new Error(`Повреждён журнал выпуска ${pending}.`);
    }
    files.add(file);
    const { text } = await readSource(root, mod, file);
    if (text !== before && text !== after) throw new Error(`Исходник ${file} изменился. База выпуска сохранена в ${pending}.`);
  }
  for (const { file, before, after } of entries) {
    const { path, text } = await readSource(root, mod, file);
    if (text === after) continue;
    if (text !== before) throw new Error(`Исходник ${file} изменился. База выпуска сохранена в ${pending}.`);
    const temporary = join(work, `baseline-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, after, { encoding: 'utf8', flag: 'wx' });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  if (await readFile(pending, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }) === saved) await rm(pending, { force: true });
}

export async function finishPendingRelease(project, id, mod) {
  const root = await realpath(project);
  const { work, prefix } = paths(root, id);
  const key = join(work, prefix);
  if (active.has(key)) return active.get(key);
  const operation = (async () => {
    const names = await readdir(work).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    const journals = names.filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort();
    if (journals.length && await realpath(work) !== work) throw new Error('Неожиданный путь журнала выпуска.');
    for (const name of journals) await finish(root, id, mod, join(work, name), work);
  })().finally(() => active.delete(key));
  active.set(key, operation);
  return operation;
}

export async function syncReleaseBaseline(project, id, economy, released) {
  const root = await realpath(project);
  const { work, prefix } = paths(root, id);
  const originals = new Map([...economy.sources, ...economy.countries, ...economy.ferries,
    ['description.txt', economy.description], ['manifest.sii', economy.manifest]]);
  const entries = [];
  for (const [file, after] of released) {
    const before = originals.get(file);
    if (!validFile(id, file) || typeof before !== 'string') throw new Error(`Файл ${file} отсутствует в исходниках.`);
    if (before !== after) entries.push({ file, before, after });
  }
  if (!entries.length) return;
  await mkdir(work, { recursive: true });
  if (await realpath(work) !== work) throw new Error('Неожиданный путь журнала выпуска.');
  const temporary = join(work, `baseline-${randomUUID()}.tmp`);
  try {
    for (const { file, before } of entries) {
      const { text } = await readSource(root, economy.mod, file);
      if (text !== before) throw new Error(`Исходник ${file} изменился за время сборки.`);
    }
    await writeFile(temporary, JSON.stringify(entries), { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, join(work, `${prefix}${Date.now()}-${randomUUID()}.json`));
  } finally {
    await rm(temporary, { force: true });
  }
  await finishPendingRelease(root, id, economy.mod);
}
