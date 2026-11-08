import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brazil, canada, cbr, europe, fedstat, frankfurter, interfax, kazakhstan, macedonia, malaysia, marketDate, mexico,
  moldova, openvan, placeName, providers, russia, serbia, ukraine, usa } from './market-sources.mjs';

const economyFile = 'def/economy_data.sii';
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const currencyRow = new RegExp('^([\\t ]*currency_code\\[\\]:[\\t ]*"([A-Z]{3}\\*?)"[^\\r\\n]*\\r?\\n[\\t ]*currency_ratio\\[\\]:[\\t ]*)(' + number + ')(?=[\\t #\\r\\n]|$)', 'gm');
const priceFields = ['fuel_price', 'petrol_price'];
const litresPerUsGallon = 3.785411784;

const europeanIso = {
  aut: 'AT', bel: 'BE', bgr: 'BG', hrv: 'HR', cyp: 'CY', cze: 'CZ', dnk: 'DK', est: 'EE', fin: 'FI',
  fra: 'FR', deu: 'DE', grc: 'GR', hun: 'HU', irl: 'IE', ita: 'IT', lva: 'LV', ltu: 'LT', lux: 'LU',
  mlt: 'MT', nld: 'NL', pol: 'PL', prt: 'PT', rou: 'RO', svk: 'SK', svn: 'SI', esp: 'ES', swe: 'SE',
  gbr: 'GB', nor: 'NO', che: 'CH'
};
const etsRegions = { rus: 'russia', srb: 'serbia', mkd: 'macedonia', mda: 'moldova', ukr: 'ukraine', kaz: 'kazakhstan', mys: 'malaysia' };
// ETS2 country identifiers mapped to OpenVan ISO-2 markets and expected diesel currencies.
const openVanMarkets = {
  alb: ['AL', 'ALL'], and: ['AD', 'EUR'], arm: ['AM', 'AMD'], aze: ['AZ', 'AZN'],
  bfa: ['BF', 'XOF'], bgd: ['BD', 'BDT'], bih: ['BA', 'BAM'], blr: ['BY', 'BYN'], bwa: ['BW', 'BWP'],
  can: ['CA', 'CAD'], chn: ['CN', 'CNY'], dza: ['DZ', 'DZD'], egy: ['EG', 'EGP'], eth: ['ET', 'ETB'],
  fro: ['FO', 'DKK'], geo: ['GE', 'GEL'], gha: ['GH', 'GHS'], gmb: ['GM', 'GMD'], idn: ['ID', 'IDR'],
  isl: ['IS', 'ISK'], isr: ['IL', 'ILS'], jor: ['JO', 'JOD'], ken: ['KE', 'KES'], kgz: ['KG', 'KGS'],
  khm: ['KH', 'KHR'], lao: ['LA', 'LAK'], lbn: ['LB', 'LBP'], lie: ['LI', 'CHF'], mar: ['MA', 'MAD'],
  mco: ['MC', 'EUR'], mdv: ['MV', 'MVR'], mli: ['ML', 'XOF'], mmr: ['MM', 'MMK'], mne: ['ME', 'EUR'],
  mng: ['MN', 'MNT'], mrt: ['MR', 'MRU'], ner: ['NE', 'XOF'], nga: ['NG', 'NGN'], nru: ['NR', 'AUD'],
  phl: ['PH', 'PHP'], png: ['PG', 'PGK'], sau: ['SA', 'SAR'], sen: ['SN', 'XOF'], sgp: ['SG', 'SGD'],
  ssd: ['SS', 'SSP'], syr: ['SY', 'SYP'], tha: ['TH', 'THB'], tls: ['TL', 'USD'], tun: ['TN', 'TND'],
  tur: ['TR', 'TRY'], tza: ['TZ', 'TZS'], uga: ['UG', 'UGX'], uzb: ['UZ', 'UZS'], vnm: ['VN', 'VND'],
  xxk: ['XK', 'EUR'], zaf: ['ZA', 'ZAR'], zmb: ['ZM', 'ZMW']
};
const feedsByRegion = {
  europe: { currency: 'EUR', feeds: { europe } },
  russia: { currency: 'RUB', feeds: { russia, interfax, fedstat } },
  serbia: { currency: 'RSD', feeds: { serbia } },
  macedonia: { currency: 'MKD', feeds: { macedonia } },
  moldova: { currency: 'MDL', feeds: { moldova } },
  ukraine: { currency: 'UAH', feeds: { ukraine } },
  kazakhstan: { currency: 'KZT', feeds: { kazakhstan } },
  malaysia: { currency: 'MYR', feeds: { malaysia } },
  openvan: { feeds: { openvan } },
  brazil: { currency: 'BRL', feeds: { brazil } },
  usa: { currency: 'USD', unit: 'US gal', feeds: { usa } },
  canada: { currency: 'CAD', feeds: { canada } },
  mexico: { currency: 'MXN', feeds: { mexico } }
};

export async function readSiiDirectory(root, folder) {
  const entries = await readdir(join(root, folder), { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && /\.s(?:ii|ui)$/i.test(entry.name))
    .map(entry => `${folder}/${entry.name}`).sort();
  return new Map(await Promise.all(files.map(async file => [file, await readFile(join(root, file), 'utf8')])));
}

export function currencies(source) {
  return new Map([...source.matchAll(currencyRow)].map(([, , code, rate]) => [code, Number(rate)]));
}

export function siiValue(source, key) {
  const found = [...source.matchAll(new RegExp(`^[\\t ]*${key}[\\t ]*:[\\t ]*("[^"\\r\\n]*"|[^#\\r\\n]+)`, 'gm'))];
  return found.length === 1 ? found[0][1].trim().replace(/^"|"$/g, '') : undefined;
}

function countryEntries(economy) {
  const ats = economy.mod.currency === 'USD';
  const entries = [];
  for (const [file, source] of economy.countries) {
    const iso = siiValue(source, 'iso_country_code')?.toLowerCase();
    const name = siiValue(source, 'name') ?? file.split('/').at(-1);
    const fields = (ats ? priceFields : ['fuel_price']).filter(key => Number.isFinite(Number(siiValue(source, key))));
    if (!fields.length || !iso || ['xz', 'ata'].includes(iso)) continue;
    const openVanMarket = !ats && Object.hasOwn(openVanMarkets, iso) ? openVanMarkets[iso] : undefined;
    const brazilianState = !ats && iso === 'bra' && ['paraiba', 'pernambuco'].includes(placeName(name));
    const region = ats ? iso === 'mex' ? 'mexico' : /^(?:can|ca)[a-z]{2}$/.test(iso) ? 'canada' : /^us[a-z]{2}$/.test(iso) ? 'usa' : null
      : brazilianState ? 'brazil' : etsRegions[iso] ?? (Object.hasOwn(europeanIso, iso) ? 'europe' : openVanMarket ? 'openvan' : null);
    const key = ats || brazilianState ? placeName(name) : europeanIso[iso] ?? openVanMarket?.[0] ?? iso;
    const currency = openVanMarket?.[1] ?? feedsByRegion[region]?.currency;
    entries.push({ file, name, region, key, currency, fields });
  }
  return entries;
}

export async function refreshMarket(economy, mode) {
  if (!['fuel', 'rates', 'all'].includes(mode)) throw new Error('Выберите данные для обновления.');
  const today = marketDate();
  const base = economy.mod.currency === 'USD' ? 'USD' : 'EUR';
  const requested = [...currencies(economy.sources.get(economyFile)).keys()].filter(code => code !== base && !code.endsWith('*'));
  const entries = mode === 'rates' ? [] : countryEntries(economy);
  const regions = [...new Set(entries.map(entry => entry.region).filter(Boolean))].map(region => feedsByRegion[region]);
  const fuelCurrencies = entries.map(entry => entry.currency).filter(code => code && code !== base);
  const codes = mode === 'fuel' ? requested.filter(code => fuelCurrencies.includes(code)) : requested;
  const quoteCodes = [...new Set([...codes, ...fuelCurrencies])];
  const feeds = Object.assign({ frankfurter: () => frankfurter(base, quoteCodes, today), cbr: () => cbr(base, today) },
    ...regions.map(region => region.feeds));
  const failures = new Map();
  const results = new Map(await Promise.all(Object.entries(feeds).map(async ([source, load]) => {
    try {
      const result = await load(today);
      if (!result.size) failures.set(source, 'свежие данные не найдены');
      return [source, result];
    } catch (error) {
      const code = error.cause?.code;
      const reason = code === 'SELF_SIGNED_CERT_IN_CHAIN' ? 'не удалось проверить сертификат HTTPS' : code ?? error.message;
      failures.set(source, reason);
      return [source, new Map()];
    }
  })));
  const rates = {};
  const quotes = {};
  const missingRates = [];
  for (const code of quoteCodes) {
    const official = results.get('cbr').get(code);
    const blended = results.get('frankfurter').get(code);
    const quote = code === 'RUB' ? official : blended ?? official;
    if (quote) quotes[code] = quote;
    if (!codes.includes(code)) continue;
    if (quote) rates[code] = quote;
    else missingRates.push(code);
  }
  const fuel = {};
  const missingFuel = new Set();
  const uncoveredFuel = new Set();
  let russianPrice;
  for (const entry of entries) {
    const region = feedsByRegion[entry.region];
    if (!region) {
      uncoveredFuel.add(entry.name);
      continue;
    }
    const observations = Object.keys(region.feeds).map(source => results.get(source).get(entry.key)).filter(Boolean);
    for (const field of entry.fields) {
      const candidates = observations.map(observation => observation[field]).filter(Boolean);
      const price = entry.region === 'russia'
        ? candidates.filter(item => item.source !== 'fedstat').sort((a, b) => b.date.localeCompare(a.date))[0] ?? candidates[0]
        : candidates[0];
      const rate = price?.currency === base ? 1 : quotes[price?.currency]?.value;
      const amount = price && rate ? pricePerLitre(price, rate) : 0;
      if (price && price.currency === entry.currency && amount > 0 && amount <= 20) {
        const quote = price.currency !== base && !requested.includes(price.currency) ? quotes[price.currency] : undefined;
        (fuel[entry.file] ??= {})[field] = quote ? { ...price, quote } : price;
        if (entry.region === 'russia') russianPrice = price;
      } else {
        missingFuel.add(`${entry.name} · ${field === 'fuel_price' ? 'дизель' : 'бензин'}`);
      }
    }
  }
  if (mode === 'fuel') {
    const used = new Set(Object.values(fuel).flatMap(fields => Object.values(fields).map(price => price.currency)));
    for (const code of Object.keys(rates)) if (!used.has(code)) delete rates[code];
  }
  const notices = [];
  if (russianPrice) {
    if (russianPrice.source === 'fedstat') {
      notices.push(`Россия · резервная месячная цена ЕМИСС за ${russianPrice.date}. Свежая недельная цена недоступна.`);
    } else if (russianPrice.source === 'interfax') {
      notices.push(`Россия · недельная цена Росстата за ${russianPrice.date} по публикации Интерфакса.`);
    }
    failures.delete('russia');
    failures.delete('interfax');
    failures.delete('fedstat');
  }
  if (results.get('canada')?.size && missingFuel.has('Nunavut · бензин') && missingFuel.has('Nunavut · дизель')) {
    notices.push('Нунавут · Statistics Canada публикует цены по выбранным городам. В этой выборке Нунавута нет.');
  }
  const warnings = [...failures].map(([source, reason]) => `${providers[source][0]}: ${reason}.`).sort();
  return { rates, fuel, warnings, notices, missingRates, missingFuel: [...missingFuel].sort(),
    uncoveredFuel: [...uncoveredFuel].sort(), fetchedAt: today };
}

function safeQuote(quote, allowedSources, max) {
  return allowedSources.includes(quote?.source) && /^\d{4}-\d{2}(?:-\d{2})?$/.test(quote.date) &&
    Number.isFinite(quote.value) && quote.value > 0 && quote.value < max;
}

function draftObject(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Повреждены рыночные данные черновика.');
  return value;
}

function detail(quote) {
  return `${providers[quote.source][0]} · ${quote.date}`;
}

function pricePerLitre(price, rate) {
  return Number((price.value / Number(rate.toFixed(6)) / (price.unit === 'US gal' ? litresPerUsGallon : 1)).toFixed(6));
}

export function applyMarket(economy, sources, changes, market, replaceField) {
  const { rates: ratesDraft, fuel: fuelDraft } = draftObject(market);
  const rates = draftObject(ratesDraft);
  const fuel = draftObject(fuelDraft);
  const base = economy.mod.currency === 'USD' ? 'USD' : 'EUR';
  const original = sources.get(economyFile);
  const knownRates = currencies(original);
  for (const [code, quote] of Object.entries(rates)) {
    if (!knownRates.has(code) || code === base || code.endsWith('*') || !safeQuote(quote, ['frankfurter', 'cbr'], 1e6) ||
        (code === 'RUB' && quote.source !== 'cbr')) throw new Error(`Некорректная котировка ${code}.`);
  }
  const updated = original.replace(currencyRow, (line, prefix, code, before) => {
    if (!Object.hasOwn(rates, code)) return line;
    const quote = rates[code];
    const after = Number(quote.value.toFixed(6));
    if (after <= 0) throw new Error(`Котировка ${code} ниже точности игры.`);
    if (Number(before) === after) return line;
    changes.push({ file: economyFile, key: `Курс ${code}/${base}`, before, after, detail: detail(quote) });
    return prefix + after;
  });
  sources.set(economyFile, updated);
  const entries = new Map(countryEntries(economy).map(entry => [entry.file, entry]));
  for (const [file, prices] of Object.entries(fuel)) {
    const entry = entries.get(file);
    if (!entry?.region) throw new Error(`Недоступный регион топлива: ${file}.`);
    const { unit: expectedUnit = 'L', feeds } = feedsByRegion[entry.region];
    const allowedSources = Object.keys(feeds);
    let source = economy.countries.get(file);
    for (const [key, price] of Object.entries(draftObject(prices))) {
      if (!entry.fields.includes(key) || !safeQuote(price, allowedSources, 10_000_000) || price.currency !== entry.currency || price.unit !== expectedUnit) {
        throw new Error(`Некорректная цена топлива в ${file}.`);
      }
      const rate = knownRates.has(price.currency) ? rates[price.currency] : price.quote;
      if (price.currency !== base && !safeQuote(rate, ['frankfurter', 'cbr'], 1e6)) {
        throw new Error(`Для топлива нужен свежий курс ${price.currency}/${base}.`);
      }
      const conversion = price.currency === base ? 1 : Number(rate.value.toFixed(6));
      if (!(conversion > 0)) throw new Error(`Для топлива нужен свежий курс ${price.currency}/${base}.`);
      const after = pricePerLitre(price, conversion);
      if (after <= 0 || after > 20) throw new Error(`Цена топлива вне допустимого диапазона в ${file}.`);
      source = replaceField(source, key, before => {
        if (Number(before) === after) return before;
        const origin = `${detail(price)} · ${Number(price.value.toFixed(4))} ${price.currency}/${price.unit}`;
        const converted = rate && price.currency !== base ? ` · курс ${conversion} ${price.currency}/${base} (${detail(rate)})` : '';
        changes.push({ file, key: `${entry.name} · ${key}`, before, after, detail: `${origin}${converted} · в игре ${base}/л` });
        return after;
      });
    }
    if (source !== economy.countries.get(file)) sources.set(file, source);
  }
  return economy.mod.currency === 'RUB' ? currencies(updated).get('RUB') : 1;
}
