import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { definitionChange } from './definitions.mjs';

const defaults = {
  light: { agency: 1.2, freight: 1.25, fixed: 1.15, garage: 0.8, abandoned: 0.75, roadTrip: 1.2, police: 0.75 },
  hard: { agency: 0.85, freight: 0.8, fixed: 0.9, garage: 1.25, abandoned: 1.25, roadTrip: 0.85, police: 1.25 }
};
const groups = [
  ['agency', 'Ставка агентств', ['driver_revenue_coef_per_km']],
  ['freight', 'Ставки рынка и биржи грузов', ['revenue_coef_per_km', 'cargo_market_revenue_coef_per_km']],
  ['fixed', 'Фиксированная часть грузового заказа', ['fixed_revenue']],
  ['garage', 'Покупка и улучшение гаражей', ['price_small_garage', 'price_garage_upgrade']],
  ['abandoned', 'Штраф за отказ от грузового заказа', ['abandoned_job_fine']],
  ['roadTrip', 'Выплаты Road Trip', ['quick_job_revenue_fixed', 'quick_job_revenue_coef_per_km',
    'dispatch_job_revenue_fixed', 'dispatch_job_revenue_coef_per_km']]
];
const police = 'def/police_data.sii';
const fineLabels = [
  'ДТП', 'Пропуск отдыха', 'Встречная полоса', 'Превышение скорости (камера)',
  'Езда без света ночью', 'Проезд на красный', 'Превышение скорости', 'Пропуск взвешивания',
  'Запрещённый прицеп', 'Пропуск досмотра', 'Нарушение правил пересечения границы',
  'Движение по аварийной обочине', 'Езда с неисправностью', 'Запрещённый прицеп (весовой контроль)'
];

export function profileGroups(economy, profile, saved) {
  const settings = groups.flatMap(([key, label, keys]) => {
    const fields = economy.fields.filter(field => keys.includes(field.key));
    if (!fields.length) return [];
    const parameters = fields.map(({ file, key, label, value, original, monetary, effect, observation }) =>
      ({ file, key, label, value, original, integer: monetary, effect, observation }));
    return [{ key, label, factor: saved?.factors[key] ?? defaults[profile][key], parameters }];
  });
  if (economy.mod.currency === 'EUR' || economy.mod.currency === 'USD') {
    const step = economy.mod.currency === 'USD' ? '$5' : '€5';
    const parameters = [...economy.sources.get(police).matchAll(/^[\t ]*(fine_amounts\[(\d+)\]):[\t ]*(\d+)(?=[\t ]*(?:#|\r?$))/gm)]
      .map(([, key, index, raw]) => ({ file: police, key, label: fineLabels[index] ?? key, value: Number(raw),
        original: Number(raw), integer: true, rounding: 5 }));
    if (parameters.length) settings.push({ key: 'police', label: `Дорожные штрафы · округление базы до ${step}`,
      factor: saved?.factors.police ?? defaults[profile].police, parameters });
  }
  return settings;
}

const scale = (value, factor, { integer, rounding = 1 }) =>
  integer ? Math.round(value * factor / rounding) * rounding : Number((value * factor).toFixed(6));

export function profileDraft(economy, request, replaceField, metadata) {
  if (request?.revision !== economy.revision) throw new Error('База Realistic изменилась. Перезагрузите профиль.');
  const factors = request.factors;
  if (!factors || Object.keys(factors).length !== economy.profileGroups.length ||
      economy.profileGroups.some(({ key }) => !Number.isFinite(factors[key]) || factors[key] <= 0 || factors[key] > 10)) {
    throw new Error('Коэффициенты должны быть больше 0 и не превышать 10.');
  }
  const sources = new Map(economy.sources);
  const base = new Map([...economy.sources, ...economy.countries, ...economy.ferries]);
  const before = new Map(economy.profileRelease?.files ?? base);
  const changes = [];
  for (const { key, parameters } of economy.profileGroups) {
    const factor = factors[key];
    for (const field of parameters) {
      if (factor === 1 && !field.rounding) continue;
      sources.set(field.file, replaceField(sources.get(field.file), field.key,
        raw => String(scale(Number(raw), factor, field))));
    }
  }
  const files = new Map([...base, ...sources]);
  for (const [file, after] of files) {
    const previous = before.get(file);
    if (previous === after) continue;
    if (previous === undefined) {
      changes.push({ file, key: 'Файл', before: '—', after: 'Добавлен' });
      continue;
    }
    // Report known economic fields individually and retain a diff for inherited changes.
    let rest = previous;
    const reportFields = file === police
      ? economy.profileGroups.find(group => group.key === 'police')?.parameters ?? []
      : economy.fields.filter(field => field.file === file);
    for (const field of reportFields) {
      if (file === police && !previous.includes(field.key)) continue;
      let next;
      replaceField(after, field.key, raw => { next = raw; return raw; });
      rest = replaceField(rest, field.key, raw => {
        if (raw !== next) changes.push({ file, key: field.key, before: raw, after: next });
        return next;
      });
    }
    if (rest !== after) changes.push(definitionChange(file, rest, after));
  }
  for (const file of before.keys()) {
    if (!files.has(file)) changes.push({ file, key: 'Файл', before: 'Был в релизе', after: 'Удалён' });
  }
  if (economy.profileRelease) {
    for (const [key, label] of [['version', 'Версия мода'], ['gameVersion', 'Версия игры']]) {
      const previous = economy.profileRelease[key];
      if (previous !== metadata[key]) changes.push({ file: 'manifest.sii', key: label, before: previous, after: metadata[key] });
    }
  }
  return { sources: files, changes, factors, files: [...files], fuelSources: new Set(), skippedFerries: [] };
}

export async function readProfileRelease(root, id) {
  const file = join(root, '.panel-work', `profile-${id}.json`);
  return readFile(file, 'utf8').then(JSON.parse, error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

export async function saveProfileRelease(root, id, state) {
  const work = join(await realpath(root), '.panel-work');
  await mkdir(work, { recursive: true });
  if (await realpath(work) !== work) throw new Error('Неожиданный путь базы профиля.');
  const temp = join(work, `profile-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(state), { encoding: 'utf8', flag: 'wx' });
    await rename(temp, join(work, `profile-${id}.json`));
  } finally {
    await rm(temp, { force: true });
  }
}
