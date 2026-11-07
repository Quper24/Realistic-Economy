import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, copyFile, cp, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { replaceField } from './economy.mjs';

const run = promisify(execFile);
export const panel = dirname(fileURLToPath(import.meta.url));
export const root = join(panel, '..', '..');
export const releaseDirectory = join(root, 'dist');
const work = join(root, '.panel-work');
const assets = ['def', 'unit', 'material', 'ui', 'vehicle', 'locale'];
const compatibility = /^[\t ]*compatible_versions\[\]:[^\r\n]*\r?\n/gm;
const fuelAttributions = {
  europe: 'European diesel prices adapted from EU EnergyPrices (https://www.euenergyprices.eu/en/data), based on the European Commission Weekly Oil Bulletin, SSB, DESNZ and Swiss FSO. CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).',
  malaysia: 'Peninsular Malaysia diesel prices adapted from the Ministry of Finance (https://data.gov.my/data-catalogue/fuelprice). CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).',
  openvan: 'Additional diesel prices adapted from OpenVan.camp (https://openvan.camp/). CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).'
};

export function buildMetadata(economy, body) {
  const version = body.version ?? economy.version;
  const gameVersion = body.gameVersion ?? economy.gameVersion;
  if (typeof version !== 'string' || !/^\d[\w.-]{0,31}$/.test(version)) {
    throw new Error('Версия мода должна начинаться с цифры и содержать до 32 латинских букв, цифр, точек, дефисов или подчёркиваний.');
  }
  if (typeof gameVersion !== 'string' || !/^\d{1,3}\.\d{1,3}$/.test(gameVersion)) {
    throw new Error('Укажите версию игры в формате 1.62.');
  }
  return { version, gameVersion, compatible: gameVersion + '.*' };
}

async function makeStage(source, stage, economy, draft, metadata, test) {
  await mkdir(stage);
  for (const name of assets) {
    const dir = join(source, name);
    try {
      await stat(dir);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    await cp(dir, join(stage, name), { recursive: true });
  }
  for (const [file, contents] of draft.sources) await writeFile(join(stage, file), contents, 'utf8');
  let manifest = replaceField(economy.manifest, 'package_version', () => `"${metadata.version}"`);
  manifest = manifest.replace(compatibility, '');
  manifest = replaceField(manifest, 'package_version', raw => raw + `\n\t\tcompatible_versions[]: "${metadata.compatible}"`);
  if (test) manifest = replaceField(manifest, 'display_name', raw => raw.replace(/^"/, '"[TEST] '));
  await writeFile(join(stage, 'manifest.sii'), manifest, 'utf8');
  await copyFile(test ? join(panel, 'test.jpg') : join(source, 'image.jpg'), join(stage, 'image.jpg'));
  const description = join(stage, 'description.txt');
  await copyFile(join(source, 'description.txt'), description);
  const attributions = [...draft.fuelSources].map(source => fuelAttributions[source]).filter(Boolean);
  if (attributions.length) await appendFile(description, `\n\n${attributions.join('\n')}\n`);
  return manifest;
}

async function pack(stage, archive) {
  try {
    await run(join(panel, 'scs_packer.exe'), ['create', archive, '-root', stage], { windowsHide: true, timeout: 120_000 });
  } catch (error) {
    throw new Error('SCS Packer: ' + (error.stderr?.trim() || error.stdout?.trim() || error.message));
  }
  const file = await open(archive, 'r');
  try {
    const header = Buffer.alloc(6);
    await file.read(header, 0, header.length, 0);
    if (header.subarray(0, 4).toString('ascii') !== 'SCS#' || header.readUInt16LE(4) !== 2) {
      throw new Error('SCS Packer не создал архив HashFS v2.');
    }
  } finally {
    await file.close();
  }
}

function versionEntry(unit, name, versions, informational = false) {
  return [
    `\tpackage_version_info : .${unit}`, '\t{',
    `\t\tpackage_name: "${name}"`,
    ...versions.map(version => `\t\tcompatible_versions[]: "${version}"`),
    ...(informational ? ['\t\tinformational: true'] : []),
    '\t}'
  ].join('\n');
}

async function makeWorkshop(source, mod, destination, stage, manifest, metadata, archive) {
  const history = join(source, '_steam', mod.workshop);
  const previous = await readFile(join(history, 'versions.sii'), 'utf8');
  const entries = [];
  const archives = new Set();
  await mkdir(destination);
  for (const match of previous.matchAll(/package_version_info\s*:\s*\.([\w.]+)\s*\{([^{}]*)\}/g)) {
    const [, unit, block] = match;
    const name = block.match(/package_name:\s*"([a-z0-9_]+)"/)?.[1];
    const versions = [...block.matchAll(/compatible_versions\[\]:\s*"([\d.*]+)"/g)]
      .map(item => item[1]).filter(version => version !== metadata.compatible);
    if (!versions.length) continue;
    if (!name || ['current', 'notice'].includes(name) || ['current', 'notice'].includes(unit)) {
      throw new Error('Некорректный архив в исходном versions.sii.');
    }
    if (!archives.has(name)) {
      await copyFile(join(history, name + '.scs'), join(destination, name + '.scs'));
      archives.add(name);
    }
    entries.push(versionEntry(unit, name, versions));
  }
  await copyFile(archive, join(destination, 'current.scs'));
  entries.push(versionEntry('current', 'current', [metadata.compatible]));
  const notice = join(destination, 'notice');
  await mkdir(notice);
  await copyFile(join(stage, 'image.jpg'), join(notice, 'image.jpg'));
  await writeFile(join(notice, 'manifest.sii'), manifest.replace(compatibility, ''), 'utf8');
  await writeFile(join(notice, 'description.txt'), `This mod release supports game version ${metadata.gameVersion}.\n`, 'utf8');
  entries.push(versionEntry('notice', 'notice', [], true));
  await writeFile(join(destination, 'versions.sii'), `SiiNunit\n{\n${entries.join('\n\n')}\n}\n`, 'utf8');
}

export async function buildPackage(id, economy, draft, metadata, testDestination) {
  const test = Boolean(testDestination);
  const source = join(root, economy.mod.dir);
  const destination = testDestination ?? releaseDirectory;
  if (!test) await mkdir(destination, { recursive: true });
  if (!(await stat(destination).catch(() => null))?.isDirectory()) {
    throw new Error(`Папка назначения не найдена: ${destination}`);
  }
  await mkdir(work, { recursive: true });
  const resolvedRoot = await realpath(root);
  if (await realpath(work) !== join(resolvedRoot, '.panel-work') ||
      (!test && await realpath(destination) !== join(resolvedRoot, 'dist'))) {
    throw new Error('Неожиданный путь папки сборки.');
  }
  const temporary = await mkdtemp(join(work, test ? 'test-' : 'release-'));
  const filename = test ? `quper-${id}-test.scs` : `quper-${id}-${metadata.version}.scs`;
  const incoming = test ? join(destination, `.${filename}.${randomUUID()}.tmp`) : null;
  try {
    const stage = join(temporary, 'stage');
    const manifest = await makeStage(source, stage, economy, draft, metadata, test);
    const output = join(temporary, 'output');
    await mkdir(output);
    const archive = join(output, filename);
    await pack(stage, archive);
    if (test) {
      const path = join(destination, filename);
      await copyFile(archive, incoming);
      await rename(incoming, path);
      return { path, changes: draft.changes };
    }
    await makeWorkshop(source, economy.mod, join(output, 'steam-workshop'), stage, manifest, metadata, archive);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const folder = join(destination, `quper-${id}-${metadata.version}-${timestamp}-${randomUUID().slice(0, 8)}`);
    await rename(output, folder);
    return { path: join(folder, filename), workshop: join(folder, 'steam-workshop'), changes: draft.changes };
  } finally {
    if (incoming) await rm(incoming, { force: true }).catch(() => {});
    const resolvedTemp = await realpath(temporary);
    if (dirname(resolvedTemp) === join(resolvedRoot, '.panel-work')) {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
