import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const mods = {
  ets2: { name: 'ETS2', dir: 'RealisticEconomyQuper', game: 'Euro Truck Simulator 2', currency: 'EUR' },
  'ets2-russia': { name: 'ETS2 Russia', dir: 'RealisticEconomyRussianQuper', game: 'Euro Truck Simulator 2', currency: 'RUB' },
  ats: { name: 'ATS', dir: 'ATSRealisticEconomyXPandFerry', game: 'American Truck Simulator', currency: 'USD' }
};

const truck = 'def/economy_data.sii';
const roadTrip = 'def/car_economy_data.sii';
const truckFields = [
  ['Гаражи', 'Покупка малого гаража', 'price_small_garage', true],
  ['Гаражи', 'Улучшение гаража', 'price_garage_upgrade', true],
  ['Грузовые заказы', 'Фиксированная выплата', 'fixed_revenue', true],
  ['Грузовые заказы', 'Базовая ставка за км', 'revenue_per_km_base', true],
  ['Грузовые заказы', 'Коэффициент рынка грузов', 'revenue_coef_per_km', false],
  ['Грузовые заказы', 'Коэффициент рынка перевозок', 'cargo_market_revenue_coef_per_km', false]
];
const roadTripFields = [
  ['Road Trip', 'Быстрый заказ · фиксированная выплата', 'quick_job_revenue_fixed', true],
  ['Road Trip', 'Быстрый заказ · коэффициент за км', 'quick_job_revenue_coef_per_km', false],
  ['Road Trip', 'Диспетчерский заказ · фиксированная выплата', 'dispatch_job_revenue_fixed', true],
  ['Road Trip', 'Диспетчерский заказ · коэффициент за км', 'dispatch_job_revenue_coef_per_km', false]
];

export function replaceField(source, key, readValue) {
  const pattern = new RegExp('^([\\t ]*' + key + '[\\t ]*:[\\t ]*)([^\\r\\n#]+?)([\\t ]*)(?=#|\\r?$)', 'gm');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Поле ${key} должно встречаться ровно один раз.`);
  return source.replace(pattern, (_line, prefix, old, suffix) => prefix + readValue(old) + suffix);
}

export async function loadEconomy(root, id) {
  const mod = mods[id];
  const files = id === 'ats' ? [truck, roadTrip] : [truck];
  const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(join(root, mod.dir, file), 'utf8')])));
  const rub = id === 'ets2-russia'
    ? Number(sources.get(truck).match(/^[\t ]*currency_code\[\]:[\t ]*"RUB"[\t ]*\r?\n[\t ]*currency_ratio\[\]:[\t ]*([\d.]+)/m)?.[1])
    : 1;
  if (!Number.isFinite(rub) || rub <= 0) throw new Error('Не найден курс RUB в исходном economy_data.sii.');
  const fields = [];
  for (const [file, definitions] of [[truck, truckFields], [roadTrip, id === 'ats' ? roadTripFields : []]]) {
    for (const [group, label, key, monetary] of definitions) {
      replaceField(sources.get(file), key, raw => {
        const original = Number(raw);
        if (!Number.isFinite(original)) throw new Error(`Некорректное число в ${file}, поле ${key}.`);
        const value = monetary ? Number((original * rub).toFixed(4)) : original;
        fields.push({ group, label, key, monetary, file, original, value });
        return raw;
      });
    }
  }
  const revision = createHash('sha256').update(JSON.stringify([...sources])).digest('hex');
  return { mod, fields, sources, revision, rub };
}

export function makeDraft(economy, request) {
  if (request?.revision !== economy.revision) throw new Error('Исходные файлы изменились. Перезагрузите мод в пульте.');
  const values = request.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Ожидаются настройки черновика.');
  const sources = new Map(economy.sources);
  const fields = new Map(economy.fields.map(field => [field.key, field]));
  const changes = [];
  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    if (!field || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (field?.monetary ? 1e12 : 1e4)) {
      throw new Error(`Недопустимое значение поля ${key}.`);
    }
    const next = field.monetary ? Math.round(value / economy.rub) : Number(value.toFixed(6));
    if (value === field.value || next === field.original) continue;
    sources.set(field.file, replaceField(sources.get(field.file), key, () => String(next)));
    changes.push({ key, label: field.label, file: field.file, before: field.original, after: next });
  }
  return { sources, changes };
}
