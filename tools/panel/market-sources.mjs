import { readFile } from 'node:fs/promises';
import { get } from 'node:https';
import { rootCertificates } from 'node:tls';
import { zipEntries } from './market-zip.mjs';

const day = 86_400_000;
const maxDownload = 12_000_000;
const currencyPattern = /^[A-Z]{3}$/;

export const providers = {
  europe: ['EU EnergyPrices', 'https://www.euenergyprices.eu/en/data'],
  russia: ['Росстат', 'https://rosstat.gov.ru/compendium/document/50798'],
  interfax: ['Росстат через Интерфакс', 'https://www.interfax.ru/search/news/'],
  fedstat: ['ЕМИСС / Росстат', 'https://www.fedstat.ru/indicator/31448'],
  serbia: ['Минторг Сербии · потолок цены', 'https://must.gov.rs/vesti/sr/'],
  macedonia: ['РКЕ Северной Македонии · потолок цены', 'https://www.erc.org.mk/'],
  moldova: ['ANRE Молдовы · потолок цены', 'https://anre.md/index.php/motorina-3-3'],
  ukraine: ['Минфин / Консалтинговая группа А-95', 'https://index.minfin.com.ua/ua/markets/fuel/'],
  kazakhstan: ['Бюро национальной статистики Казахстана · летний дизель', 'https://stat.gov.kz/ru/industries/economy/prices/spreadsheets/?name=19087'],
  malaysia: ['Минфин Малайзии · полуостровная часть', 'https://data.gov.my/data-catalogue/fuelprice'],
  openvan: ['OpenVan.camp · обновление сводки', 'https://openvan.camp/en/developers'],
  brazil: ['ANP Бразилии · средняя цена дизеля S10', 'https://www.gov.br/anp/pt-br/assuntos/precos-e-defesa-da-concorrencia/precos/levantamento-de-precos-de-combustiveis-ultimas-semanas-pesquisadas'],
  usa: ['AAA', 'https://gasprices.aaa.com/state-gas-price-averages/'],
  canada: ['Statistics Canada', 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810000101'],
  mexico: ['CNE', 'https://www.gob.mx/cne/articulos/consulta-de-datos-abiertos'],
  frankfurter: ['Frankfurter', 'https://frankfurter.dev/'],
  cbr: ['Банк России', 'https://www.cbr.ru/currency_base/daily/']
};

export function marketDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function recent(date, maxDays, today) {
  const time = Date.parse(date);
  return Number.isFinite(time) && date <= today && Date.parse(today) - time <= maxDays * day;
}

function isoDate(year, month, date) {
  return `${String(year).length === 2 ? '20' + year : year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

async function download(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return readBody(response.body);
}

async function readBody(body) {
  const chunks = [];
  let length = 0;
  for await (const chunk of body) {
    length += chunk.length;
    if (length > maxDownload) throw new Error('ответ источника слишком большой');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function page(url, options) {
  return decodePage(await download(url, options));
}

function decodePage(bytes) {
  return /(?:windows-1251|cp1251)/i.test(bytes.subarray(0, 3000).toString())
    ? new TextDecoder('windows-1251').decode(bytes) : bytes.toString('utf8');
}

async function rosstatPage(url) {
  if (url.origin !== new URL(providers.russia[1]).origin) throw new Error('неожиданный адрес Росстата');
  // Official Russian Trusted Root CA from https://www.gosuslugi.ru/crt, scoped to this origin.
  const certificate = await readFile(new URL('./rosstat-ca.pem', import.meta.url), 'utf8');
  const response = await new Promise((resolve, reject) => {
    get(url, {
      ca: [...rootCertificates, certificate], rejectUnauthorized: true, signal: AbortSignal.timeout(10_000)
    }, resolve).on('error', reject);
  });
  if (response.statusCode !== 200) {
    response.destroy();
    throw new Error(`HTTP ${response.statusCode}`);
  }
  return decodePage(await readBody(response));
}

function xmlText(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code) => {
    if (!code.startsWith('#')) return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[code] ?? entity;
    const point = code[1] === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
}

function plain(html) {
  return xmlText(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function placeName(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function csv(text) {
  const [header, ...lines] = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const cells = line => [...line.matchAll(/(?:^|,)(?:"((?:[^"\r\n]|"")*)"|([^,]*))/g)]
    .map(([, quoted, bare]) => quoted?.replaceAll('""', '"') ?? bare);
  const names = cells(header);
  return lines.map(line => Object.fromEntries(cells(line).map((value, index) => [names[index], value])));
}

async function archiveEntries(url, files) {
  return zipEntries(await download(url), files, maxDownload);
}

function observation(values, key, type, value, date, source, currency, unit = 'L') {
  if (!key || !Number.isFinite(value) || value <= 0) return;
  const slot = values.get(key) ?? {};
  if (!slot[type] || slot[type].date < date) slot[type] = { value, date, source, currency, unit };
  values.set(key, slot);
}

export async function europe(today) {
  const values = new Map();
  for (const row of csv(await page('https://www.euenergyprices.eu/api/data/fuel.csv'))) {
    if (row.fuel_type === 'diesel' && recent(row.date, 75, today)) {
      observation(values, row.country_code, 'fuel_price', Number(row.price_eur_l), row.date, 'europe', 'EUR');
    }
  }
  return values;
}

let openVanSnapshot;

export async function openvan(today) {
  // The publisher asks clients to wait at least ten minutes between polls.
  if (!openVanSnapshot || openVanSnapshot.until <= Date.now()) {
    openVanSnapshot = {
      until: Date.now() + 600_000,
      data: page('https://openvan.camp/api/fuel/prices').then(JSON.parse)
    };
  }
  const { success, data, _attribution: attribution } = await openVanSnapshot.data;
  if (success !== true || !data || attribution?.license !== 'CC BY 4.0') throw new Error('изменилась структура или лицензия сводки');
  const values = new Map();
  for (const [code, item] of Object.entries(data)) {
    const date = item.fetched_at?.slice(0, 10);
    if (item.country_code !== code || item.is_excluded !== false || item.sources_count < 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) || !recent(date, 21, today)) continue;
    for (const grade of ['diesel', 'diesel_regular']) {
      const price = item.prices?.[grade];
      const currency = item.currencies?.[grade] ?? item.currency;
      const unit = item.units?.[grade] ?? item.unit;
      if (unit !== 'liter' || !currencyPattern.test(currency) || !(price > 0)) continue;
      observation(values, code, 'fuel_price', price, date, 'openvan', currency);
      break;
    }
  }
  return values;
}

function tableRows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
    [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, cell]) => plain(cell)));
}

function decimal(value) {
  return Number(value?.replace(',', '.'));
}

function diesel(key, source, currency, amount, date, maxDays, today) {
  const values = new Map();
  if (recent(date, maxDays, today)) observation(values, key, 'fuel_price', amount, date, source, currency);
  return values;
}

export async function serbia(today) {
  const index = await page(providers.serbia[1]);
  const path = index.match(/href="(\/vest\/sr\/\d+\/obavestenje-o-najvisoj-maloprodajnoj-ceni-derivata-nafte-evro-dizel[^"<>]*\.php)"/i)?.[1];
  if (!path) return new Map();
  const text = plain(await page(new URL(path, providers.serbia[1])));
  const period = text.match(/period od \d+ časova (\d{1,2})\.\s*(\p{L}+)\s+(\d{4})\.?\s*godine do \d+ časova (\d{1,2})\.\s*(\p{L}+)\s+(\d{4})/iu);
  if (!period) return new Map();
  const months = 'januara februara marta aprila maja juna jula avgusta septembra oktobra novembra decembra'.split(' ');
  const startMonth = months.indexOf(period[2].toLowerCase()) + 1;
  const endMonth = months.indexOf(period[5].toLowerCase()) + 1;
  if (!startMonth || !endMonth || isoDate(period[6], endMonth, period[4]) < today) return new Map();
  const amount = text.match(/EVRO DIZEL,?\s+u iznosu\s+(\d+(?:[,.]\d+)?)\s+dinara za jedan litar/i)?.[1];
  return diesel('srb', 'serbia', 'RSD', decimal(amount), isoDate(period[3], startMonth, period[1]), 10, today);
}

export async function macedonia(today) {
  const html = await page(providers.macedonia[1]);
  const when = plain(html).match(/Одлука за утврдување на највисоки малопродажни цени на нафтени деривати и горива за транспорт\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (!when) return new Map();
  const row = tableRows(html).find(([fuel]) => /^ЕУРОДИЗЕЛ БС\b|^ЕУРОДИЗЕЛ БС \(/i.test(fuel ?? ''));
  const amount = row?.[1]?.match(/^(\d+(?:[,.]\d+)?)\s*ден\s*\/\s*л$/i)?.[1];
  return diesel('mkd', 'macedonia', 'MKD', decimal(amount), isoDate(when[3], when[2], when[1]), 10, today);
}

export async function moldova(today) {
  const html = await page(providers.moldova[1]);
  const table = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .find(([, body]) => plain(body).includes('Data publicării') && plain(body).includes('TVA PC'))?.[1];
  const values = new Map();
  if (!table) return values;
  const months = 'ianuarie februarie martie aprilie mai iunie iulie august septembrie octombrie noiembrie decembrie'.split(' ');
  for (const [label, ...columns] of tableRows(table)) {
    const when = label?.match(/^(\d{1,2})\s+(\p{L}+)\s+(\d{4})$/u);
    if (!when || columns.length !== 8) continue;
    const month = months.indexOf(when[2].toLowerCase()) + 1;
    const date = isoDate(when[3], month, when[1]);
    if (month && recent(date, 7, today)) observation(values, 'mda', 'fuel_price', decimal(columns.at(-1)), date, 'moldova', 'MDL');
  }
  return values;
}

export async function ukraine(today) {
  const html = await page(providers.ukraine[1]);
  for (const [, table] of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const when = plain(table).match(/Середні ціни на пальне по Україні на\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
    if (!when) continue;
    const row = tableRows(table).find(([fuel]) => fuel === 'Дизельне паливо');
    return diesel('ukr', 'ukraine', 'UAH', decimal(row?.[2]), isoDate(when[3], when[2], when[1]), 7, today);
  }
  return new Map();
}

export async function malaysia(today) {
  const values = new Map();
  for (const row of csv(await page('https://storage.data.gov.my/commodities/fuelprice.csv'))) {
    if (row.series_type === 'level' && recent(row.date, 14, today)) {
      observation(values, 'mys', 'fuel_price', Number(row.diesel), row.date, 'malaysia', 'MYR');
    }
  }
  return values;
}

export async function usa(today) {
  const html = await page(providers.usa[1]);
  const when = plain(html).match(/Price as of\s+(\d+)\/(\d+)\/(\d+)/i);
  const values = new Map();
  if (!when) return values;
  const date = isoDate(when[3], when[1], when[2]);
  if (!recent(date, 7, today)) return values;
  for (const [, table] of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = tableRows(table);
    const header = rows.findIndex(row => row.includes('State') && row.includes('Regular') && row.includes('Diesel'));
    if (header < 0) continue;
    const columns = rows[header];
    for (const row of rows.slice(header + 1)) {
      const name = placeName(row[columns.indexOf('State')] ?? '');
      for (const [column, key] of [['Regular', 'petrol_price'], ['Diesel', 'fuel_price']]) {
        const price = row[columns.indexOf(column)];
        if (price?.startsWith('$')) observation(values, name, key, Number(price.slice(1)), date, 'usa', 'USD', 'US gal');
      }
    }
  }
  return values;
}

const canadaFuels = {
  'Diesel fuel at self service filling stations': 'fuel_price',
  'Regular unleaded gasoline at self service filling stations': 'petrol_price'
};

export async function canada(today) {
  const [data] = await archiveEntries('https://www150.statcan.gc.ca/n1/tbl/csv/18100001-eng.zip', ['18100001.csv']);
  const groups = new Map();
  for (const row of csv(data)) {
    const fuel = canadaFuels[row['Type of fuel']];
    const date = row.REF_DATE;
    const price = Number(row.VALUE);
    if (!fuel || row.UOM !== 'Cents per litre' || !/^\d{4}-\d{2}$/.test(date) || !recent(date + '-01', 100, today) || price <= 0) continue;
    const province = row.GEO.endsWith('Ontario/Quebec') ? 'Ontario' : row.GEO.split(', ').at(-1);
    const key = placeName(province);
    const groupKey = `${key}/${fuel}/${date}`;
    const group = groups.get(groupKey) ?? { key, fuel, date, prices: [] };
    group.prices.push(price);
    groups.set(groupKey, group);
  }
  const values = new Map();
  for (const { key, fuel, date, prices } of groups.values()) {
    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length / 100;
    observation(values, key, fuel, average, date, 'canada', 'CAD');
  }
  return values;
}

function spreadsheetRows(xml, strings) {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(([, row]) => {
    const cells = [...row.matchAll(/<c\b([^>]*?)(?<!\/)>([\s\S]*?)<\/c>/g)];
    return Object.fromEntries(cells.flatMap(([, attributes, cell]) => {
      const column = attributes.match(/\br="([A-Z]+)\d+"/)?.[1];
      const value = cell.match(/<v>([^<]+)<\/v>/)?.[1];
      if (!column || value === undefined) return [];
      return [[column, /\bt="s"/.test(attributes) ? strings[Number(value)] : value]];
    }));
  });
}

function spreadsheetStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, value]) => plain(value));
}

export async function brazil(today) {
  const index = await page(providers.brazil[1]);
  const href = index.match(/href="([^"<>]+\/resumo_semanal_lpc_[\d_-]+\.xlsx)"/i)?.[1];
  const values = new Map();
  if (!href) return values;
  const url = new URL(href, providers.brazil[1]);
  if (url.origin !== 'https://www.gov.br' || !url.pathname.startsWith('/anp/')) throw new Error('ссылка на таблицу сменила адрес');
  const [shared, sheet] = await archiveEntries(url, ['xl/sharedStrings.xml', 'xl/worksheets/sheet3.xml']);
  const rows = spreadsheetRows(sheet, spreadsheetStrings(shared));
  if (!rows.some(row => row.B === 'DATA FINAL' && row.D === 'ESTADOS' && row.H === 'PREÇO MÉDIO REVENDA')) return values;
  for (const row of rows) {
    const state = placeName(row.D ?? '');
    const serial = Number(row.B);
    if (!['paraiba', 'pernambuco'].includes(state) || row.E !== 'OLEO DIESEL S10' || row.G !== 'R$/l' ||
        !Number.isInteger(serial) || serial < 40_000 || serial > 70_000) continue;
    const date = new Date(Date.UTC(1899, 11, 30) + serial * day).toISOString().slice(0, 10);
    if (recent(date, 16, today)) observation(values, state, 'fuel_price', Number(row.H), date, 'brazil', 'BRL');
  }
  return values;
}

export async function kazakhstan(today) {
  const index = await page(providers.kazakhstan[1]);
  const report = index.match(/href="(\/api\/iblock\/element\/\d+\/file\/ru\/)"[^>]*>\s*Розничные цены на отдельные товары и услуги в Республике Казахстан\s*\(\s*([а-яё]+)\s+(\d{4})/i);
  if (!report) return new Map();
  const months = 'январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь'.split(' ');
  const month = months.indexOf(report[2].toLowerCase()) + 1;
  const date = isoDate(report[3], month, 1);
  if (!month || !recent(date, 100, today)) return new Map();
  const [shared, sheet] = await archiveEntries(new URL(report[1], providers.kazakhstan[1]), [
    'xl/sharedStrings.xml', 'xl/worksheets/sheet5.xml'
  ]);
  const rows = spreadsheetRows(sheet, spreadsheetStrings(shared));
  if (!rows.some(row => row.A === 'в теңге')) return new Map();
  const header = rows.find(row => Object.values(row).includes('Республика Казахстан'));
  const column = Object.keys(header ?? {}).find(key => header[key] === 'Республика Казахстан');
  const row = rows.find(item => item.A === 'Дизельное топливо летнее, литр');
  return diesel('kaz', 'kazakhstan', 'KZT', decimal(row?.[column]), date.slice(0, 7), 100, today);
}

export async function mexico(today) {
  const index = await page(providers.mexico[1]);
  const href = index.match(/href="([^"<>]+\.xlsx)"[^>]*>\s*Precios Diarios Promedio Nacional y Precios Promedio Mensuales/i)?.[1];
  if (!href) throw new Error('ссылка на ежемесячный отчёт не найдена');
  const url = new URL(xmlText(href), providers.mexico[1]);
  if (url.origin !== 'https://www.cne.gob.mx') throw new Error('ссылка на отчёт сменила домен');
  const [shared, regular, diesel] = await archiveEntries(url, [
    'xl/sharedStrings.xml', 'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet5.xml'
  ]);
  const strings = spreadsheetStrings(shared);
  const months = 'ENE FEB MAR ABR MAY JUN JUL AGO SEP OCT NOV DIC'.split(' ');
  const values = new Map();
  for (const [sheet, fuel, title] of [[regular, 'petrol_price', 'gasolina regular'], [diesel, 'fuel_price', 'diesel']]) {
    const rows = spreadsheetRows(sheet, strings);
    if (!placeName(rows[1]?.A ?? '').includes(`precios promedio mensuales de ${title}`) || placeName(rows[2]?.A ?? '') !== 'pesos por litro') continue;
    const header = rows.findIndex(row => row.A === 'ENTIDAD');
    if (header < 0) continue;
    let year;
    const dates = [];
    for (const [column, label] of Object.entries(rows[header + 1])) {
      year = rows[header][column] ?? year;
      const month = months.indexOf(label) + 1;
      if (!/^\d{4}$/.test(year) || !month) continue;
      const date = `${year}-${String(month).padStart(2, '0')}`;
      if (recent(date + '-01', 100, today)) dates.push([column, date]);
    }
    for (const row of rows.slice(header + 2)) {
      if (!row.A) continue;
      for (const [column, date] of dates) observation(values, placeName(row.A), fuel, Number(row[column]), date, 'mexico', 'MXN');
    }
  }
  return values;
}

const russianMonths = 'января февраля марта апреля мая июня июля августа сентября октября ноября декабря'.split(' ');

export async function russia(today) {
  const index = await rosstatPage(new URL(providers.russia[1]));
  const links = [...index.matchAll(/href=["']([^"'<>]*\/storage\/mediabank\/\d+[_-](\d{2})[-.](\d{2})[-.](\d{4})\.html?)["']/gi)]
    .map(([, path, date, month, year]) => ({ url: new URL(path, providers.russia[1]), date: isoDate(year, month, date) }))
    .filter(item => item.url.origin === new URL(providers.russia[1]).origin && recent(item.date, 16, today))
    .sort((a, b) => b.date.localeCompare(a.date));
  const unique = [...new Map(links.map(item => [item.url.href, item])).values()].slice(0, 18);
  const reports = await Promise.allSettled(unique.map(({ url }) => rosstatPage(url)));
  const values = new Map();
  for (const result of reports) {
    if (result.status !== 'fulfilled') continue;
    const html = result.value;
    const title = plain(html).match(/о потребительских ценах на нефтепродукты\s+с\s+\d+\s+[а-яё]+\s+по\s+(\d+)\s+([а-яё]+)\s+(\d{4})/i);
    if (!title || !plain(html).includes('рублей за литр')) continue;
    const month = russianMonths.indexOf(title[2].toLowerCase()) + 1;
    const date = isoDate(title[3], month, title[1]);
    if (!month || !recent(date, 16, today)) continue;
    const row = tableRows(html).find(cells => /^Российская Федерация\s*[*¹1]?$/i.test(cells[0]) && cells.length === 6);
    const price = Number(row?.at(-1)?.replace(',', '.'));
    if (price > 1) observation(values, 'rus', 'fuel_price', price, date, 'russia', 'RUB');
  }
  return values;
}

export async function interfax(today) {
  const start = new Date(Date.parse(today) - 14 * day).toISOString().slice(0, 10);
  const index = new URL(providers.interfax[1]);
  index.search = new URLSearchParams({ phrase: 'Средняя цена ДТ в стране', df: start, dt: today, sec: '0' });
  const list = await page(index);
  const links = [...list.matchAll(/href="(\/(?:russia|business)\/\d+)">\s*Цены на бензин в РФ(?=\s|[<,.:])/gi)];
  const paths = [...new Set(links.map(([, path]) => path))].slice(0, 4);
  const reports = await Promise.allSettled(paths.map(path => page(new URL(path, index))));
  const values = new Map();
  for (const report of reports) {
    if (report.status !== 'fulfilled') continue;
    const html = report.value;
    if (!/<meta\s+property="article:tag"\s+content="Росстат"/i.test(html)) continue;
    const published = html.match(/<meta\s+property="article:published_time"\s+content="(\d{4}-\d{2}-\d{2})T/i)?.[1];
    if (!recent(published, 14, today)) continue;
    const observationRow = plain(html).match(/Средняя цена ДТ в стране на (\d{1,2}) ([а-яё]+) (?:равнялась|составила) (\d+[,.]\d{2}) руб\. за литр/i);
    if (!observationRow) continue;
    const month = russianMonths.indexOf(observationRow[2].toLowerCase()) + 1;
    if (!month) continue;
    const [year, publicationMonth] = published.split('-').map(Number);
    const date = isoDate(month > publicationMonth ? year - 1 : year, month, observationRow[1]);
    if (date <= published && recent(date, 16, today)) {
      observation(values, 'rus', 'fuel_price', decimal(observationRow[3]), date, 'interfax', 'RUB');
    }
  }
  return values;
}

// The published EMISS grid uses these classifier IDs for month, product, unit and geography.
export async function fedstat(today) {
  const months = [1540283, 1540282, 1540236, 1540229, 1540235, 1540234, 1540233, 1540228, 1540276, 1540273, 1540272, 1540230];
  const [year, month] = today.split('-').map(Number);
  const recentPeriods = Array.from({ length: 4 }, (_, offset) => new Date(Date.UTC(year, month - 1 - offset, 1)));
  const body = new URLSearchParams();
  for (const id of [0, 30611, 57831, 58273]) body.append('lineObjectIds', id);
  for (const id of [3, 33560]) body.append('columnObjectIds', id);
  const filters = new Set(['0_31448', '30611_950351', '57831_1688487', '57831_1849012', '58273_1755196']);
  for (const period of recentPeriods) {
    filters.add(`3_${period.getUTCFullYear()}`);
    filters.add(`33560_${months[period.getUTCMonth()]}`);
  }
  for (const id of filters) body.append('selectedFilterIds', id);
  const { results } = JSON.parse(await page('https://www.fedstat.ru/indicator/dataGrid.do?id=31448', {
    method: 'POST', body, headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: providers.fedstat[1] }
  }));
  const values = new Map();
  for (const row of results) {
    if (row.dim30611 !== 'рубль' || row.dim58273 !== 'Дизельное топливо, л' ||
        !['Российская Федерация', 'Российская Федерация без учета новых субъектов (с 01.01.2023)'].includes(row.dim57831)) continue;
    for (const period of recentPeriods) {
      const prefix = `dim${period.getUTCFullYear()}_${months[period.getUTCMonth()]}_`;
      const amount = Object.entries(row).find(([key]) => key.startsWith(prefix))?.[1];
      const date = period.toISOString().slice(0, 10);
      if (recent(date, 100, today)) {
        observation(values, 'rus', 'fuel_price', Number(String(amount).replace(',', '.')), date.slice(0, 7), 'fedstat', 'RUB');
      }
    }
  }
  return values;
}

export async function frankfurter(base, codes, today) {
  const query = new URLSearchParams({ base, quotes: codes.join(','), date: today });
  const rows = JSON.parse(await page(`https://api.frankfurter.dev/v2/rates?${query}`));
  const values = new Map();
  for (const { base: quoteBase, quote, rate, date } of rows) {
    if (quoteBase === base && codes.includes(quote) && recent(date, 10, today) && rate > 0 && Number.isFinite(rate)) {
      values.set(quote, { value: rate, date, source: 'frankfurter' });
    }
  }
  return values;
}

export async function cbr(base, today) {
  const [year, month, date] = today.split('-');
  const xml = await page(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${date}/${month}/${year}`);
  const when = xml.match(/<ValCurs\b[^>]+\bDate="(\d+)\.(\d+)\.(\d+)"/i);
  const values = new Map();
  if (!when) return values;
  const asOf = isoDate(when[3], when[2], when[1]);
  if (!recent(asOf, 10, today)) return values;
  const rubles = new Map([['RUB', 1]]);
  for (const [, row] of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const code = row.match(/<CharCode>([^<]+)<\/CharCode>/)?.[1];
    const value = Number(row.match(/<Value>([^<]+)<\/Value>/)?.[1].replace(',', '.'));
    const nominal = Number(row.match(/<Nominal>([^<]+)<\/Nominal>/)?.[1]);
    if (currencyPattern.test(code) && value > 0 && nominal > 0) rubles.set(code, value / nominal);
  }
  if (!rubles.has(base)) return values;
  for (const [code, value] of rubles) {
    values.set(code, { value: rubles.get(base) / value, date: asOf, source: 'cbr' });
  }
  return values;
}
