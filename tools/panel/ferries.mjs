import { siiValue } from './market.mjs';

const settings = {
  ets2: { speed: 30, firstHour: 7, halfHour: 3, currency: 'EUR' },
  'ets2-russia': { speed: 30, firstHour: 5, halfHour: 3, currency: 'EUR' },
  ats: { speed: 15, firstHour: 2, halfHour: 1, currency: 'USD' }
};
const acceleration = 0.2;
const portMinutes = 20;

export function ferrySettings(id) {
  return { ...settings[id], portMinutes };
}

export function recalculateFerries(economy, sources, changes, replaceField) {
  const { speed, firstHour, halfHour } = economy.ferrySettings;
  const cruise = speed / 3.6;
  const accelerationDistance = cruise ** 2 / acceleration;
  const skipped = [];
  for (const [file, original] of economy.ferries) {
    const units = [...original.matchAll(/^\s*ferry_connection\s*:\s*([\w.]+)\s*\{/gm)];
    if (/^\s*SiiNunit\s*\{\s*\}\s*$/.test(original)) continue;
    const distance = Number(siiValue(original, 'distance'));
    const time = Number(siiValue(original, 'time'));
    const price = Number(siiValue(original, 'price'));
    if (units.length !== 1 || ![distance, time, price].every(value => Number.isFinite(value) && value >= 0) ||
        /tunnel|tunel|rail|train/i.test(file + ' ' + units[0][1])) {
      skipped.push(file);
      continue;
    }
    const metres = distance * 1000;
    const travel = metres < accelerationDistance ? 2 * Math.sqrt(metres / acceleration)
      : 2 * cruise / acceleration + (metres - accelerationDistance) / cruise;
    const minutes = portMinutes + Math.round(travel / 60);
    const fare = firstHour + halfHour * Math.max(0, Math.ceil((minutes - 60) / 30));
    let edited = original;
    for (const [key, before, after] of [['time', time, minutes], ['price', price, fare]]) {
      if (before === after) continue;
      edited = replaceField(edited, key, () => after);
      changes.push({ file, key, before, after, detail: `${distance} км · ${speed} км/ч · ${portMinutes} мин в порту` });
    }
    if (edited !== original) sources.set(file, edited);
  }
  return skipped;
}
