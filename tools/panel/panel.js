const form = document.querySelector('#settings');
const fields = document.querySelector('#fields');
const modName = document.querySelector('#mod');
const status = document.querySelector('#status');
const changes = document.querySelector('#changes');
const preview = document.querySelector('#preview');
const test = document.querySelector('#test');
const modButtons = [...document.querySelectorAll('[data-mod]')];
let selected = 'ets2-russia';
let current;

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
  preview.disabled = test.disabled = busy || !current;
  for (const button of modButtons) button.disabled = busy;
  for (const input of fields.querySelectorAll('input')) input.disabled = busy;
}

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem('re-draft-' + selected));
    return saved?.revision === current.revision ? saved.values : {};
  } catch {
    return {};
  }
}

function renderSettings() {
  fields.replaceChildren();
  const saved = readSaved();
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
    const label = document.createElement('label');
    const unit = field.monetary ? ' · ' + current.mod.currency : '';
    label.textContent = field.label + unit;
    const input = document.createElement('input');
    input.type = 'number';
    input.name = field.key;
    input.required = true;
    input.min = '0';
    input.max = field.monetary ? '1000000000000' : '10000';
    input.step = 'any';
    input.value = Number.isFinite(saved?.[field.key]) ? saved[field.key] : field.value;
    label.append(input);
    groups.get(field.group).append(label);
  }
}

function draft() {
  const values = Object.fromEntries(current.fields.map(field => [field.key, form.elements.namedItem(field.key).valueAsNumber]));
  return { revision: current.revision, values };
}

function showChanges(result) {
  changes.hidden = result.changes.length === 0;
  changes.textContent = result.changes.map(change =>
    change.file + '\n' + change.key + ': ' + change.before + ' → ' + change.after
  ).join('\n\n');
}

async function choose(id) {
  selected = id;
  current = null;
  changes.hidden = true;
  setBusy(true);
  status.textContent = 'Читаем настройки…';
  for (const button of modButtons) button.setAttribute('aria-pressed', String(button.dataset.mod === id));
  try {
    current = await api();
    modName.textContent = current.mod.name;
    document.querySelector('#rate').textContent = id === 'ets2-russia'
      ? 'Курс из текущего мода · ' + current.rub + ' ₽/€'
      : 'Настройки из текущих игровых файлов';
    document.querySelector('#destination').textContent = 'Папка теста · ' + current.destination;
    renderSettings();
    status.textContent = 'Черновик Realistic';
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
  setBusy(true);
  changes.hidden = true;
  status.textContent = isTest ? 'Собираем тестовый пакет…' : 'Проверяем черновик…';
  try {
    const result = await api(action, body);
    showChanges(result);
    status.textContent = isTest
      ? 'Пакет TEST установлен · ' + result.path
      : result.changes.length ? 'Изменения в игровых файлах' : 'Игровые значения совпадают с исходными.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

for (const button of modButtons) button.addEventListener('click', () => choose(button.dataset.mod));
form.addEventListener('input', () => {
  if (form.checkValidity()) localStorage.setItem('re-draft-' + selected, JSON.stringify(draft()));
  changes.hidden = true;
  status.textContent = 'Черновик изменён';
});
preview.addEventListener('click', () => run('/preview'));
form.addEventListener('submit', event => {
  event.preventDefault();
  run('/test');
});
choose(selected);
