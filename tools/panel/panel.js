const form = document.querySelector('#settings');
const fields = document.querySelector('#fields');
const modName = document.querySelector('#mod');
const status = document.querySelector('#status');
const changes = document.querySelector('#changes');
const preview = document.querySelector('#preview');
const test = document.querySelector('#test');
const release = document.querySelector('#release');
const artifacts = document.querySelector('#artifacts');
const definitionPanel = document.querySelector('#definitions');
const definitionFile = document.querySelector('#definition-file');
const definitionText = document.querySelector('#definition-text');
const definitionHelp = document.querySelector('#definition-help');
const restoreDefinition = document.querySelector('#restore-definition');
const modButtons = [...document.querySelectorAll('[data-mod]')];
const marketPanel = document.querySelector('#market');
const marketStatus = document.querySelector('#market-status');
const marketOpenVan = document.querySelector('#market-openvan');
const marketDetails = document.querySelector('#market-details');
const marketUncovered = document.querySelector('#market-uncovered');
const resetMarket = document.querySelector('#reset-market');
const ferriesPanel = document.querySelector('#ferries');
const ferryButton = document.querySelector('#recalculate-ferries');
const ferryDetails = document.querySelector('#ferry-details');
let selected = 'ets2-russia';
let current;
let editedFiles = {};
let market;
let marketReports = {};
let ferry = false;

async function api(action = '', body) {
  const response = await fetch('/api/mods/' + selected + action, body && {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function setBusy(busy) {
  preview.disabled = release.disabled = busy || !current;
  test.disabled = busy || !current?.destination;
  for (const button of modButtons) button.disabled = busy;
  for (const input of form.querySelectorAll('input, select, textarea')) input.disabled = busy || !current;
  restoreDefinition.disabled = busy || !current;
  marketPanel.disabled = ferriesPanel.disabled = busy || !current;
  resetMarket.disabled = !market && !Object.keys(marketReports).length;
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem('re-draft-' + selected));
    return saved && [current.revision, current.previousRevision].includes(saved.revision) ? saved : {};
  } catch {
    return {};
  }
}

function renderSettings() {
  fields.replaceChildren();
  const saved = readSaved();
  market = saved.dataRevision === current.dataRevision ? saved.market : undefined;
  marketReports = saved.dataRevision === current.dataRevision ? saved.marketReports ?? {} : {};
  ferry = saved.dataRevision === current.dataRevision && saved.ferry === true;
  showMarket();
  showFerry();
  form.elements.version.value = saved.version ?? current.version;
  form.elements.gameVersion.value = saved.gameVersion ?? current.gameVersion;
  const groups = new Map();
  for (const field of current.fields) {
    if (!groups.has(field.group)) {
      const fieldset = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = field.group;
      fieldset.append(legend);
      fields.append(fieldset);
      groups.set(field.group, fieldset);
    }
    const container = document.createElement('div');
    container.className = 'field';
    const stored = saved.values?.[field.key];
    const distance = ['perKm', 'range'].includes(field.kind);
    const unit = field.monetary ? ' · ' + current.mod.currency + (distance ? '/км' : '') : '';
    const name = field.label + unit;
    const range = field.kind === 'range';
    const values = range && Array.isArray(stored) ? stored : range ? field.value : [stored ?? field.value];
    const inputs = document.createElement('div');
    if (range) {
      const title = document.createElement('strong');
      title.textContent = name;
      container.append(title);
      inputs.className = 'range-fields';
    }
    for (const [index, value] of values.entries()) {
      const label = document.createElement('label');
      label.textContent = range ? (index === 0 ? 'От' : 'До') : name;
      const input = document.createElement('input');
      input.type = 'number';
      input.name = range ? field.key + '_' + index : field.key;
      input.required = true;
      input.min = '0';
      input.max = field.monetary ? '1000000000000' : '10000';
      input.step = 'any';
      input.value = value;
      label.append(input);
      inputs.append(label);
    }
    container.append(inputs);
    const key = document.createElement('p');
    key.className = 'field-name';
    key.textContent = field.key;
    container.append(key);
    const help = document.createElement('p');
    help.textContent = [field.effect, field.observation].filter(Boolean).join(' ');
    container.append(help);
    groups.get(field.group).append(container);
  }
  editedFiles = saved.files ?? {};
  definitionFile.replaceChildren(...current.documents.map(({ file, label }) =>
    new Option(label + ' · ' + file.split('/').at(-1), file)
  ));
  definitionPanel.hidden = false;
  showDefinition();
}

function currentDefinition() {
  return current.documents.find(item => item.file === definitionFile.value);
}

function showDefinition() {
  const { file, text, effect } = currentDefinition();
  definitionText.value = editedFiles[file] ?? text;
  definitionHelp.textContent = effect + (current.mod.currency === 'RUB' ? ' В этом редакторе базовая валюта игры — EUR.' : '');
}

function keepDefinition() {
  const { file, text } = currentDefinition();
  if (definitionText.value === text) delete editedFiles[file];
  else editedFiles[file] = definitionText.value;
}

function draft() {
  const read = name => form.elements.namedItem(name).valueAsNumber;
  const values = Object.fromEntries(current.fields.map(({ key, kind }) =>
    [key, kind === 'range' ? [read(key + '_0'), read(key + '_1')] : read(key)]
  ));
  return { revision: current.revision, dataRevision: current.dataRevision, values, files: editedFiles, market, ferry,
    version: form.elements.version.value.trim(), gameVersion: form.elements.gameVersion.value.trim() };
}

function showList(details, lines) {
  const entries = lines.map(line => {
    const item = document.createElement('li');
    item.textContent = line;
    return item;
  });
  details.querySelector('ul').replaceChildren(...entries);
  details.hidden = entries.length === 0;
}

function showMarket() {
  const prices = Object.values(market?.fuel ?? {}).flatMap(Object.values);
  marketOpenVan.hidden = !prices.some(price => price.source === 'openvan');
  const rates = Object.values(market?.rates ?? {});
  const days = [...new Set(Object.values(marketReports).map(report => report.fetchedAt))].join(', ');
  const details = [
    ...new Set(Object.values(marketReports).flatMap(report => report.warnings)),
    ...(marketReports.fuel?.notices ?? []),
    ...(marketReports.rates?.missingRates ?? []).map(code => `Котировка не получена · ${code}`),
    ...(marketReports.fuel?.missingFuel ?? []).map(place => `Цена не получена · ${place}`)
  ];
  showList(marketDetails, details);
  const uncovered = marketReports.fuel?.uncoveredFuel ?? [];
  marketUncovered.querySelector('summary').textContent = `Регионы без подключённого источника (${uncovered.length})`;
  showList(marketUncovered, uncovered);
  marketStatus.textContent = market ? `В черновике · цен ${prices.length} · курсов ${rates.length} · запрос ${days}`
    : days ? 'Свежие данные для черновика не получены.' : 'Загрузите свежие цены и курсы перед проверкой черновика.';
  const rate = document.querySelector('#rate');
  const rub = market?.rates?.RUB;
  rate.textContent = selected === 'ets2-russia'
    ? rub ? `Курс в черновике · ${Number(rub.value.toFixed(6))} ₽/€ · Банк России · ${rub.date}`
      : 'Курс из текущего мода · ' + current.rub + ' ₽/€'
    : 'Настройки из текущих игровых файлов';
}

function showFerry() {
  const { speed, firstHour, halfHour, currency, portMinutes } = current.ferrySettings;
  ferryButton.setAttribute('aria-pressed', String(ferry));
  ferryButton.textContent = ferry ? 'Убрать пересчёт из черновика' : 'Пересчитать паромы';
  document.querySelector('#ferry-settings').textContent = `${speed} км/ч · ${portMinutes} мин в порту · ${firstHour} ${currency} за первый час · +${halfHour} ${currency} за следующие начатые 30 мин.`;
  showList(ferryDetails, []);
}

function showChanges(result) {
  changes.hidden = result.changes.length === 0;
  changes.textContent = result.changes.map(change => {
    const before = String(change.before), after = String(change.after);
    const description = change.key.startsWith('Редактор SII')
      ? change.key + '\nДо\n' + before + '\nПосле\n' + after
      : change.key + ': ' + before + ' → ' + after;
    return [change.file, description, change.detail].filter(Boolean).join('\n');
  }).join('\n\n');
  showList(ferryDetails, result.skippedFerries ?? []);
}

async function choose(id) {
  selected = id;
  current = null;
  definitionPanel.hidden = true;
  marketStatus.textContent = '';
  marketOpenVan.hidden = marketDetails.hidden = marketUncovered.hidden = ferryDetails.hidden = true;
  changes.hidden = true;
  artifacts.hidden = true;
  setBusy(true);
  status.textContent = 'Читаем настройки…';
  for (const button of modButtons) button.setAttribute('aria-pressed', String(button.dataset.mod === id));
  try {
    current = await api();
    modName.textContent = current.mod.name;
    document.querySelector('#destination').textContent = current.destination
      ? 'Папка теста · ' + current.destination
      : 'Папка игры недоступна. Можно собрать релиз.';
    renderSettings();
    status.textContent = `База сравнения · версия ${current.version}`;
  } catch (error) {
    fields.replaceChildren();
    status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function run(action) {
  if (!form.reportValidity()) return;
  const body = draft();
  const isTest = action === '/test';
  const isRelease = action === '/release';
  setBusy(true);
  changes.hidden = true;
  artifacts.hidden = true;
  status.textContent = isTest ? 'Собираем тестовый пакет…' : isRelease ? 'Собираем релиз…' : 'Проверяем черновик…';
  try {
    const result = await api(action, body);
    if (result.path) {
      artifacts.replaceChildren();
      const locations = isRelease
        ? [['ShareMods и Trucky', result.path], ['Steam Workshop', result.workshop]]
        : [['Пакет TEST', result.path]];
      for (const [label, path] of locations) {
        const line = document.createElement('p');
        line.textContent = label + ' · ' + path;
        artifacts.append(line);
      }
      artifacts.hidden = false;
    }
    if (isRelease && !result.baselineError) {
      localStorage.removeItem('re-draft-' + selected);
      current = await api();
      renderSettings();
    }
    showChanges(result);
    status.textContent = isTest ? 'Пакет TEST установлен' : isRelease
      ? result.baselineError ? `Релиз собран. Ошибка сохранения базы: ${result.baselineError}` : `Релиз ${current.version} собран и сохранён как база сравнения.`
      : result.changes.length ? 'Изменения в игровых файлах' : 'Игровые значения совпадают с исходными.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function saveExternal() {
  const saved = form.checkValidity() ? draft() : readSaved();
  localStorage.setItem('re-draft-' + selected, JSON.stringify({ ...saved, revision: current.revision,
    dataRevision: current.dataRevision, market, marketReports, ferry }));
  changes.hidden = artifacts.hidden = true;
}

async function loadMarket(mode) {
  setBusy(true);
  marketStatus.textContent = 'Запрашиваем свежие данные…';
  try {
    const { rates, fuel, fetchedAt, missingRates, missingFuel, uncoveredFuel, warnings, notices } = await api('/market', {
      revision: current.revision, dataRevision: current.dataRevision, mode
    });
    if (mode !== 'fuel') marketReports.rates = { fetchedAt, missingRates, warnings };
    if (mode !== 'rates') marketReports.fuel = { fetchedAt, missingFuel, uncoveredFuel, warnings, notices };
    const loaded = Object.keys(rates).length > 0 || Object.keys(fuel).length > 0;
    if (loaded) {
      market = { rates: { ...market?.rates, ...rates }, fuel: Object.keys(fuel).length ? fuel : market?.fuel ?? {} };
    }
    showMarket();
    setBusy(false);
    saveExternal();
    status.textContent = loaded ? 'Рыночные данные готовы к проверке.' : 'По этому запросу свежих данных нет.';
  } catch (error) {
    marketStatus.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function saveDraft() {
  if (form.checkValidity()) localStorage.setItem('re-draft-' + selected, JSON.stringify({ ...draft(), marketReports }));
  changes.hidden = true;
  artifacts.hidden = true;
  status.textContent = 'Черновик изменён';
}

for (const button of modButtons) button.addEventListener('click', () => choose(button.dataset.mod));
definitionFile.addEventListener('change', showDefinition);
definitionText.addEventListener('input', keepDefinition);
restoreDefinition.addEventListener('click', () => {
  delete editedFiles[definitionFile.value];
  showDefinition();
  saveDraft();
});
form.addEventListener('input', saveDraft);
for (const button of document.querySelectorAll('[data-market]')) button.addEventListener('click', () => loadMarket(button.dataset.market));
resetMarket.addEventListener('click', () => {
  market = undefined;
  marketReports = {};
  showMarket();
  saveExternal();
  setBusy(false);
  status.textContent = 'Рыночные данные убраны из черновика.';
});
ferryButton.addEventListener('click', () => {
  ferry = !ferry;
  showFerry();
  saveExternal();
  status.textContent = ferry ? 'Пересчёт паромов добавлен в черновик.' : 'Пересчёт паромов убран из черновика.';
});
preview.addEventListener('click', () => run('/preview'));
test.addEventListener('click', () => run('/test'));
release.addEventListener('click', () => run('/release'));
form.addEventListener('submit', event => event.preventDefault());
choose(selected);
