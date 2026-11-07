const common = [
  ['bank_data.sii', 'Банк и кредиты',
    'Суммы кредитов amount, ставки interest_rate, сроки duration и условия овердрафта. Суммы задаются в базовой валюте игры, ставка 0.02 означает 2%. Смотри на число в поле, поскольку старые комментарии могут расходиться с ним.'],
  ['police_data.sii', 'Дорожные штрафы',
    'Базовые суммы fine_amounts, вероятности обнаружения, множители и округление. Для итогового штрафа важны и сумма, и множители. Суммы задаются в базовой валюте игры.'],
  ['special_event_data.sii', 'Открытие возможностей',
    'Уровни и лимиты кредита, количество рейсов до первого займа и приглашения, открытие дилера и уровень доступа к прицепам.']
];

const ats = [
  ['car_economy_data.sii', 'Экономика Road Trip',
    'Ставки быстрых и диспетчерских заказов, доплаты, сроки, пороги рейтинга и штраф за отказ. В исходнике ATS денежные суммы задаются в USD.'],
  ['car_job_data.sii', 'Заказы Road Trip',
    'Отдельные типы заказов, дистанции в км, минимальный рейтинг, приоритеты клиента и допуски машин. У некоторых заказов есть собственный reward_per_km.']
];

const ets2 = [
  ['bus_economy_data.sii', 'Экономика Coaches',
    'Остановки, расписание, сроки, туристические маршруты и удовлетворённость пассажиров. Например, stops_per_route_max ограничивает число остановок вместе с отправлением.'],
  ['bus_economy_data_xp.sii', 'Уровни Coaches',
    'Требования XP для переходов между уровнями и названия уровней.']
];

export function editableDefinitions(id) {
  return [...common, ...(id === 'ats' ? ats : ets2)]
    .map(([name, label, effect]) => ({ file: 'def/' + name, label, effect }));
}

export function editorText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

export function editedDefinition(original, value, file) {
  if (typeof value !== 'string' || value.length > 180_000 || value.includes('\0')) {
    throw new Error(`Недопустимое содержимое ${file}.`);
  }
  const text = editorText(value);
  let depth = 0;
  let root = false;
  for (const token of text.matchAll(/"(?:\\.|[^"\\\r\n])*"|\/\*[\s\S]*?\*\/|(?:#|\/\/)[^\n]*|[{}"]/g)) {
    if (token[0] === '"') throw new Error(`Незакрытая строка в ${file}.`);
    if (token[0] === '{') {
      if (depth === 0 && root) throw new Error(`Лишний блок в ${file}.`);
      root = true;
      depth++;
    }
    if (token[0] === '}' && --depth < 0) throw new Error(`Лишняя закрывающая скобка в ${file}.`);
  }
  if (!/^\s*SiiNunit\b/.test(text) || !root || depth !== 0) {
    throw new Error(`Проверьте заголовок SiiNunit и фигурные скобки в ${file}.`);
  }
  const ending = original.includes('\r\n') ? '\r\n' : '\n';
  return (original.startsWith('\uFEFF') ? '\uFEFF' : '') + text.replaceAll('\n', ending);
}

export function definitionChange(file, original, edited) {
  const before = editorText(original).split('\n');
  const after = editorText(edited).split('\n');
  let first = 0;
  let tail = 0;
  while (first < before.length && first < after.length && before[first] === after[first]) first++;
  while (tail < before.length - first && tail < after.length - first &&
         before.at(-1 - tail) === after.at(-1 - tail)) tail++;
  const excerpt = lines => {
    const changed = lines.slice(first, lines.length - tail);
    return changed.slice(0, 8).join('\n') + (changed.length > 8 ? `\n… ещё ${changed.length - 8} строк` : '');
  };
  return { file, key: `Редактор SII · с строки ${first + 1}`, before: excerpt(before), after: excerpt(after) };
}
