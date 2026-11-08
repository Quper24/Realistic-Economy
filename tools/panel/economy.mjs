import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { definitionChange, editableDefinitions, editedDefinition, editorText } from './definitions.mjs';
import { ferrySettings, recalculateFerries } from './ferries.mjs';
import { applyMarket, currencies, readSiiDirectory } from './market.mjs';
import { finishPendingRelease } from './release-baseline.mjs';

export const mods = {
  ets2: { name: 'ETS2', dir: 'RealisticEconomyQuper', filename: 'RealisticEconomyQuper.scs', game: 'Euro Truck Simulator 2', currency: 'EUR', workshop: 'Realistic Economy' },
  'ets2-russia': { name: 'ETS2 Russia', dir: 'RealisticEconomyRussianQuper', filename: 'RealisticEconomyRussianQuper.scs', game: 'Euro Truck Simulator 2', currency: 'RUB', workshop: 'Realistic Economy Russian Police' },
  ats: { name: 'ATS', dir: 'ATSRealisticEconomyXPandFerry', filename: 'ATSRealisticEconomy.scs', game: 'American Truck Simulator', currency: 'USD', workshop: 'RealisticEconomyATS' }
};

const truck = 'def/economy_data.sii';
const roadTrip = 'def/car_economy_data.sii';
const truckFields = [
  ['Гаражи', 'Покупка малого гаража', 'price_small_garage', true],
  ['Гаражи', 'Улучшение гаража', 'price_garage_upgrade', true],
  ['Гаражи', 'План стартового гаража', 'garage_prod_plan_tiny', true],
  ['Гаражи', 'План малого гаража', 'garage_prod_plan_small', true],
  ['Гаражи', 'План большого гаража', 'garage_prod_plan_large', true],
  ['Гаражи', 'Скидка на топливо в гараже', 'fuel_discount_in_garage', false],
  ['Грузовые заказы', 'Фиксированная выплата', 'fixed_revenue', true],
  ['Грузовые заказы', 'Ставка рынка грузоперевозок', 'revenue_coef_per_km', false],
  ['Грузовые заказы', 'Ставка биржи грузов', 'cargo_market_revenue_coef_per_km', false],
  ['Грузовые заказы', 'Бонус за уровень', 'reward_bonus_level', false],
  ['Грузовые заказы', 'Штраф за отказ от заказа', 'abandoned_job_fine', true],
  ['Грузовые заказы', 'Штраф за 1% повреждения груза', 'cargo_damage_cost', true, 'decimal'],
  ['Грузовые заказы', 'Доля выплаты за 1% повреждения груза', 'cargo_damage_cost_factor', false],
  ['Агентства и водители', 'Фиксированная зарплата', 'minimal_driver_salary', true],
  ['Агентства и водители', 'Коэффициент быстрых заказов и зарплаты', 'driver_revenue_coef_per_km', false],
  ['Агентства и водители', 'Коэффициент зарплаты на бирже грузов', 'driver_cargo_market_revenue_coef_per_km', false],
  ['Агентства и водители', 'Базовая выручка за км', 'revenue_per_km_base', true, 'perKm'],
  ['Агентства и водители', 'Расходы на топливо за км', 'fuel_cost_per_km', true, 'range'],
  ['Агентства и водители', 'Обслуживание и страховка за км', 'driver_maintenance_cost', true, 'range'],
  ['Агентства и водители', 'Максимальное повреждение груза', 'driver_max_cargo_damage', false],
  ['Агентства и водители', 'Стоимость найма водителя', 'driver_hire_cost', true]
];
const roadTripFields = [
  ['Road Trip', 'Быстрый заказ · фиксированная выплата', 'quick_job_revenue_fixed', true],
  ['Road Trip', 'Быстрый заказ · коэффициент за км', 'quick_job_revenue_coef_per_km', false],
  ['Road Trip', 'Диспетчерский заказ · фиксированная выплата', 'dispatch_job_revenue_fixed', true],
  ['Road Trip', 'Диспетчерский заказ · коэффициент за км', 'dispatch_job_revenue_coef_per_km', false]
];

const effects = {
  price_small_garage: ['Цена покупки малого гаража. Введённая сумма задаёт стоимость напрямую.'],
  price_garage_upgrade: ['Цена улучшения гаража. Введённая сумма задаёт стоимость напрямую.'],
  garage_prod_plan_tiny: ['Целевой доход для оценки производительности самого маленького гаража.'],
  garage_prod_plan_small: ['Целевой доход для оценки производительности малого гаража.'],
  garage_prod_plan_large: ['Целевой доход для оценки производительности большого гаража.'],
  fuel_discount_in_garage: ['Доля скидки на заправку в гараже. 0.2 означает скидку 20%.'],
  abandoned_job_fine: ['Фиксированная сумма штрафа за отказ от принятого грузового заказа.'],
  cargo_damage_cost: ['Фиксированное удержание за каждый процент повреждения груза.'],
  cargo_damage_cost_factor: ['Доля общей выплаты, удерживаемая за каждый процент повреждения груза. 0.04 соответствует 4%.'],
  fixed_revenue: ['Фиксированная часть оплаты на рынке грузоперевозок и бирже грузов.', 'ETS2: 600 → 1600 добавило 95 440 ₽ на обоих рынках (+12,3% и +10,8%).'],
  revenue_coef_per_km: ['Оплата по дистанции на рынке грузоперевозок. Может менять прибыль наёмных.', 'ETS2: 0,9 → 1,8 повысило цену заказа на 92,7%. Прирост прибыли наёмных в прогонах сильно различался.'],
  cargo_market_revenue_coef_per_km: ['Оплата по дистанции на бирже грузов, в том числе для игрока.', 'ETS2: 1 → 2 повысило цену заказа на 93,5%. Эффект для прибыли наёмных с прицепами разошёлся между прогонами.'],
  reward_bonus_level: ['Бонус к выплате, связанный с уровнем.', 'ETS2, уровень 1: 0,015 → 0,15 повысило цены на всех трёх рынках примерно на 12,3–12,5%.'],
  minimal_driver_salary: ['Фиксированная зарплата наёмных и часть оплаты игрока в заказах агентств.', 'ETS2: 350 → 1350 дало +16,7% к цене заказа агентства и −78,5% к прибыли парка в одном прогоне.'],
  driver_revenue_coef_per_km: ['Оплата заказов агентств и зарплата наёмных.', 'ETS2: 0,67 → 1,67 дало +140,5% к цене заказа агентства. При малой правке в Realistic результаты парка колебались.'],
  driver_cargo_market_revenue_coef_per_km: ['Коэффициент зарплаты наёмных на бирже грузов с доступными прицепами.', 'ETS2 Realistic: 0,02 → 0,04 снизило чистую прибыль парка с прицепами на 11,7% за один 12-дневный прогон.'],
  revenue_per_km_base: ['Базовая выручка наёмных за км.', 'ETS2: 15 → 30 дало +65,6% к прибыли парка в одном прогоне. При 15 → 20 цены выбранных заказов игрока совпали.'],
  fuel_cost_per_km: ['Диапазон расходов на топливо в симуляции наёмных.', 'ETS2: (1,5; 2,0) → (3,5; 5,0) снизило прибыль парка на 98,1% в одном прогоне.'],
  driver_maintenance_cost: ['Диапазон расходов на обслуживание и страховку наёмных.', 'ETS2: (1,8; 3,0) → (5,8; 8,0) перевело парк в убыток в одном прогоне.'],
  driver_max_cargo_damage: ['Предел повреждения груза у наёмных в процентах до учёта навыка.', 'ETS2: цены выбранных заказов совпали. Влияние на прибыль требует повтора.'],
  driver_hire_cost: ['Разовый расход при найме водителя.', 'ETS2: 1500 → 500 не изменило цену выбранных заказов.'],
  quick_job_revenue_fixed: ['Фиксированная часть выплаты за быстрые заказы Road Trip. Изменение итоговой выплаты ещё не замеряли.'],
  quick_job_revenue_coef_per_km: ['Часть выплаты за быстрые заказы Road Trip, зависящая от дистанции. Чувствительность ещё не замеряли.'],
  dispatch_job_revenue_fixed: ['Фиксированная часть выплаты за диспетчерские заказы Road Trip. Изменение итоговой выплаты ещё не замеряли.'],
  dispatch_job_revenue_coef_per_km: ['Часть выплаты за диспетчерские заказы Road Trip, зависящая от дистанции. Чувствительность ещё не замеряли.']
};

export function replaceField(source, key, readValue) {
  const pattern = new RegExp('^([\\t ]*' + key + '[\\t ]*:[\\t ]*)([^\\r\\n#]+?)([\\t ]*)(?=#|\\r?$)', 'gm');
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Поле ${key} должно встречаться ровно один раз.`);
  return source.replace(pattern, (_line, prefix, old, suffix) => prefix + readValue(old) + suffix);
}

export async function loadEconomy(root, id) {
  const mod = mods[id];
  await finishPendingRelease(root, id, mod);
  const definitions = editableDefinitions(id);
  const files = [truck, ...definitions.map(item => item.file)];
  const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(join(root, mod.dir, file), 'utf8')])));
  const [countries, ferries] = await Promise.all([
    readSiiDirectory(join(root, mod.dir), 'def/country'),
    readSiiDirectory(join(root, mod.dir), 'def/ferry/connection')
  ]);
  const [manifest, description] = await Promise.all(['manifest.sii', 'description.txt'].map(file => readFile(join(root, mod.dir, file), 'utf8')));
  const version = manifest.match(/^\s*package_version:\s*"([^"]+)"/m)?.[1];
  const gameVersion = [...manifest.matchAll(/^[\t ]*compatible_versions\[\]:[\t ]*"(\d+\.\d+)\.\*"/gm)].at(-1)?.[1];
  if (!version || !gameVersion) throw new Error('Не найдены версии в manifest.sii.');
  const rub = id === 'ets2-russia' ? currencies(sources.get(truck)).get('RUB') : 1;
  if (!Number.isFinite(rub) || rub <= 0) throw new Error('Не найден курс RUB в исходном economy_data.sii.');
  const fields = [];
  for (const [file, definitions] of [[truck, truckFields], [roadTrip, id === 'ats' ? roadTripFields : []]]) {
    for (const [group, label, key, monetary, kind] of definitions) {
      replaceField(sources.get(file), key, raw => {
        const range = kind === 'range';
        const original = range ? raw.replace(/^\(|\)$/g, '').split(',').map(Number) : Number(raw);
        if (range ? original.length !== 2 || !original.every(Number.isFinite) : !Number.isFinite(original)) {
          throw new Error(`Некорректное число в ${file}, поле ${key}.`);
        }
        const display = number => monetary ? Number((number * rub).toFixed(6)) : number;
        const value = range ? original.map(display) : display(original);
        const [effect, observation] = effects[key];
        fields.push({ group, label, key, monetary, kind, file, original, value, effect, observation });
        return raw;
      });
    }
  }
  const revision = createHash('sha256').update(JSON.stringify([manifest, ...sources])).digest('hex');
  const previousFiles = id === 'ats' ? [truck, roadTrip] : [truck];
  const previousRevision = createHash('sha256')
    .update(JSON.stringify([manifest, ...previousFiles.map(file => [file, sources.get(file)])])).digest('hex');
  const dataRevision = createHash('sha256').update(JSON.stringify([...countries, ...ferries])).digest('hex');
  const documents = definitions.map(item => ({ ...item, text: editorText(sources.get(item.file)) }));
  return { mod, fields, sources, documents, revision, previousRevision, dataRevision, countries, ferries,
    ferrySettings: ferrySettings(id), rub, manifest, description, version, gameVersion };
}

const show = value => Array.isArray(value) ? `(${value.join(', ')})` : String(value);

export function makeDraft(economy, request) {
  if (request?.revision !== economy.revision) throw new Error('Исходные файлы изменились. Перезагрузите мод в пульте.');
  const values = request.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Ожидаются настройки черновика.');
  const sources = new Map(economy.sources);
  const fields = new Map(economy.fields.map(field => [field.key, field]));
  const changes = [];
  if ((request.market || request.ferry) && request.dataRevision !== economy.dataRevision) {
    throw new Error('Файлы регионов или паромов изменились. Перезагрузите мод и обновите черновик.');
  }
  const rub = request.market ? applyMarket(economy, sources, changes, request.market, replaceField) : economy.rub;
  const fuelSources = new Set(Object.values(request.market?.fuel ?? {}).flatMap(Object.values).map(price => price.source));
  const skippedFerries = request.ferry === true ? recalculateFerries(economy, sources, changes, replaceField) : [];
  const editedFiles = request.files ?? {};
  if (typeof editedFiles !== 'object' || Array.isArray(editedFiles)) throw new Error('Ожидаются правки SII.');
  const editable = new Set(economy.documents.map(item => item.file));
  for (const [file, contents] of Object.entries(editedFiles)) {
    if (!editable.has(file)) throw new Error(`Файл ${file} недоступен для редактирования.`);
    const original = sources.get(file);
    if (contents === editorText(original)) continue;
    const edited = editedDefinition(original, contents, file);
    if (edited === original) continue;
    sources.set(file, edited);
    changes.push(definitionChange(file, original, edited));
  }
  for (const [key, value] of Object.entries(values)) {
    const field = fields.get(key);
    const range = field?.kind === 'range';
    const numbers = range && Array.isArray(value) ? value : [value];
    if (!field || numbers.length !== (range ? 2 : 1) ||
        !numbers.every(n => Number.isFinite(n) && n >= 0 && n <= (field.monetary ? 1e12 : 1e4)) ||
        (range && numbers[0] > numbers[1])) {
      throw new Error(`Недопустимое значение поля ${key}.`);
    }
    const converted = numbers.map(n => {
      const native = field.monetary ? n / rub : n;
      return field.monetary && !field.kind ? Math.round(native) : Number(native.toFixed(6));
    });
    const next = show(range ? converted : converted[0]);
    const before = show(field.original);
    if (show(value) === show(field.value) || next === before) continue;
    sources.set(field.file, replaceField(sources.get(field.file), key, raw => {
      if (Number(raw) !== field.original && !range && Number(raw) !== Number(next)) {
        throw new Error(`Поле ${key} изменено и в форме, и в редакторе SII. Оставьте одну правку.`);
      }
      return next;
    }));
    changes.push({ key, label: field.label, file: field.file, before, after: next });
  }
  return { sources, changes, skippedFerries, fuelSources };
}
