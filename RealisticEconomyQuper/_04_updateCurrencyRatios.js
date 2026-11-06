const fs = require("fs");
const path = require("path");
const axios = require("axios");

// ============================================================
// НАСТРОЙКИ
// ============================================================

const FILE_PATH = path.join(__dirname, "def", "economy_data.sii");

const BASE_CURRENCY = "EUR";

// ============================================================
// ВАЛЮТЫ ETS2
// ============================================================
//
// В игре всего 21 валюта:
//
// EUR
// CHF
// CZK
// GBP
// PLN
// HUF
// DKK
// SEK
// NOK
// RUB
// BGN*
// RON
// TRY
// ALL
// BAM
// MKD
// RSD
// UAH
// KZT
// BYN
// CNY
//
// BGN* специально НЕ обновляем.
// ============================================================

const GAME_CURRENCIES = [
  "EUR",
  "CHF",
  "CZK",
  "GBP",
  "PLN",
  "HUF",
  "DKK",
  "SEK",
  "NOK",
  "RUB",
  "BGN*",
  "RON",
  "TRY",
  "ALL",
  "BAM",
  "MKD",
  "RSD",
  "UAH",
  "KZT",
  "BYN",
  "CNY",
];

// ============================================================
// ВАЛЮТЫ, КОТОРЫЕ ЗАПРАШИВАЕМ У API
// ============================================================
//
// BGN здесь отсутствует.
// BGN* из файла игры также отсутствует.
//
// EUR отдельно не запрашиваем, потому что это базовая валюта.
// ============================================================

const API_CURRENCIES = [
  "CHF",
  "CZK",
  "GBP",
  "PLN",
  "HUF",
  "DKK",
  "SEK",
  "NOK",
  "RUB",
  "RON",
  "TRY",
  "ALL",
  "BAM",
  "MKD",
  "RSD",
  "UAH",
  "KZT",
  "BYN",
  "CNY",
];

// ============================================================
// КОЛИЧЕСТВО ЗНАКОВ ПОСЛЕ ЗАПЯТОЙ
// ============================================================

const DECIMAL_PLACES = 4;

// ============================================================
// ЧТЕНИЕ ФАЙЛА
// ============================================================

function readFile() {
  if (!fs.existsSync(FILE_PATH)) {
    throw new Error(`Файл не найден: ${FILE_PATH}`);
  }

  return fs.readFileSync(FILE_PATH, "utf-8");
}

// ============================================================
// ПАРСИНГ ВАЛЮТ ИЗ economy_data.sii
// ============================================================

function parseCurrencies(content) {
  const lines = content.split(/\r?\n/);

  const result = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith("currency_code[]")) {
      const codeMatch = line.match(/currency_code\[\]:\s*"([^"]+)"/);

      if (!codeMatch) {
        i++;
        continue;
      }

      const code = codeMatch[1];

      const ratioLine = lines[i + 1]?.trim();

      const ratioMatch = ratioLine?.match(/currency_ratio\[\]:\s*([\d.]+)/);

      const ratio = ratioMatch ? parseFloat(ratioMatch[1]) : null;

      result.push({
        code,
        ratio,
        start: i,
        ratioLine: i + 1,
      });

      i += 2;
    } else {
      i++;
    }
  }

  return result;
}

// ============================================================
// ЗАГРУЗКА КУРСОВ ИЗ FRANKFURTER
// ============================================================

async function fetchLatestRates() {
  console.log("🌐 Загрузка актуальных курсов валют...");

  console.log(`   Базовая валюта: ${BASE_CURRENCY}`);

  console.log(`   Валют к загрузке: ${API_CURRENCIES.length}`);

  const quotes = API_CURRENCIES.join(",");

  const url =
    `https://api.frankfurter.dev/v2/rates` +
    `?base=${BASE_CURRENCY}` +
    `&quotes=${quotes}`;

  try {
    const response = await axios.get(url, {
      timeout: 15000,
    });

    if (!Array.isArray(response.data)) {
      throw new Error("API вернул неожиданный формат данных");
    }

    // EUR является базовой валютой
    const rates = {
      EUR: 1,
    };

    for (const item of response.data) {
      if (
        item &&
        typeof item.quote === "string" &&
        typeof item.rate === "number" &&
        Number.isFinite(item.rate)
      ) {
        rates[item.quote] = item.rate;
      }
    }

    return rates;
  } catch (error) {
    if (error.response) {
      throw new Error(`Frankfurter API: HTTP ${error.response.status}`);
    }

    throw new Error(`Frankfurter API: ${error.message}`);
  }
}

// ============================================================
// ПРОВЕРКА ПОЛУЧЕННЫХ КУРСОВ
// ============================================================
//
// Проверяем только EUR + API_CURRENCIES.
// BGN* здесь специально отсутствует.
// ============================================================

function validateRates(rates) {
  const requiredCurrencies = ["EUR", ...API_CURRENCIES];

  const missing = [];

  for (const currency of requiredCurrencies) {
    if (rates[currency] === undefined || !Number.isFinite(rates[currency])) {
      missing.push(currency);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Не получены курсы валют: ${missing.join(", ")}`);
  }

  return true;
}

// ============================================================
// ПРОВЕРКА ВАЛЮТ В ФАЙЛЕ
// ============================================================

function validateFileCurrencies(currencyData) {
  const fileCurrencies = currencyData.map((item) => item.code);

  // Проверяем, что все валюты ETS2 присутствуют.
  const missing = GAME_CURRENCIES.filter(
    (currency) => !fileCurrencies.includes(currency),
  );

  if (missing.length > 0) {
    throw new Error(
      `В economy_data.sii отсутствуют валюты: ${missing.join(", ")}`,
    );
  }

  // Дополнительные валюты не являются ошибкой.
  const unexpected = fileCurrencies.filter(
    (currency) => !GAME_CURRENCIES.includes(currency),
  );

  if (unexpected.length > 0) {
    console.warn(
      `⚠️ В файле есть дополнительные валюты: ${unexpected.join(", ")}`,
    );
  }
}

// ============================================================
// ФОРМАТИРОВАНИЕ КУРСА
// ============================================================

function formatRate(rate) {
  return rate.toFixed(DECIMAL_PLACES);
}

// ============================================================
// ОБНОВЛЕНИЕ economy_data.sii
// ============================================================

function updateContent(content, currencyData, latestRates) {
  const lines = content.split(/\r?\n/);

  for (const entry of currencyData) {
    const { code, ratioLine } = entry;

    // ========================================================
    // BGN* НЕ ТРОГАЕМ
    // ========================================================

    if (code === "BGN*") {
      continue;
    }

    // ========================================================
    // Получаем новый курс
    // ========================================================

    const rate = latestRates[code];

    if (rate === undefined) {
      continue;
    }

    const formattedRate = formatRate(rate);

    // ========================================================
    // Записываем новый курс
    // ========================================================

    lines[ratioLine] = `\tcurrency_ratio[]: ${formattedRate}`;
  }

  return lines.join("\n");
}

// ============================================================
// СОЗДАНИЕ BACKUP
// ============================================================

function createBackup() {
  const backupPath = `${FILE_PATH}.bak`;

  fs.copyFileSync(FILE_PATH, backupPath);

  console.log(`💾 Backup создан: ${backupPath}`);
}

// ============================================================
// ВЫВОД ИЗМЕНЕНИЙ В КОНСОЛЬ
// ============================================================

function printRates(currencyData, latestRates) {
  console.log("");

  console.log("============================================================");

  console.log("💱 ИЗМЕНЕНИЯ КУРСОВ");

  console.log("============================================================");

  for (const entry of currencyData) {
    const { code, ratio } = entry;

    // BGN* пропускаем
    if (code === "BGN*") {
      console.log(
        `${code.padEnd(5)} ` +
          `${formatRate(ratio).padStart(10)} → ` +
          `${formatRate(ratio).padStart(10)} ` +
          `= НЕ ИЗМЕНЯЕТСЯ`,
      );

      continue;
    }

    const newRate = latestRates[code];

    if (newRate === undefined) {
      continue;
    }

    const difference = newRate - ratio;

    const percent = ratio !== 0 ? (difference / ratio) * 100 : 0;

    let arrow = "=";

    if (difference > 0) {
      arrow = "↑";
    } else if (difference < 0) {
      arrow = "↓";
    }

    console.log(
      `${code.padEnd(5)} ` +
        `${formatRate(ratio).padStart(10)} → ` +
        `${formatRate(newRate).padStart(10)} ` +
        `${arrow} ` +
        `${percent >= 0 ? "+" : ""}` +
        `${percent.toFixed(2)}%`,
    );
  }

  console.log("============================================================");

  console.log("");
}

// ============================================================
// СОХРАНЕНИЕ ЛОГА
// ============================================================

function saveLogs(currencyData, latestRates) {
  const logPath = path.join(__dirname, "currency-update.log");

  const now = new Date();

  const lines = [];

  lines.push("============================================================");

  lines.push(`Обновление валют: ${now.toISOString()}`);

  lines.push("============================================================");

  for (const entry of currencyData) {
    const { code, ratio } = entry;

    // BGN* не обновляется,
    // но записываем его в лог для информации.
    if (code === "BGN*") {
      lines.push(
        `${code.padEnd(5)} | ` +
          `${formatRate(ratio).padStart(10)} -> ` +
          `${formatRate(ratio).padStart(10)} | ` +
          `НЕ ИЗМЕНЯЕТСЯ`,
      );

      continue;
    }

    const newRate = latestRates[code];

    if (newRate === undefined) {
      continue;
    }

    const difference = newRate - ratio;

    const percent = ratio !== 0 ? (difference / ratio) * 100 : 0;

    lines.push(
      `${code.padEnd(5)} | ` +
        `${formatRate(ratio).padStart(10)} -> ` +
        `${formatRate(newRate).padStart(10)} | ` +
        `${percent >= 0 ? "+" : ""}` +
        `${percent.toFixed(2)}%`,
    );
  }

  lines.push("");

  fs.appendFileSync(logPath, lines.join("\n"), "utf-8");

  console.log(`📝 Лог обновления: ${logPath}`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  try {
    console.log("");

    console.log("============================================================");

    console.log("🚛 ETS2 CURRENCY UPDATER");

    console.log("============================================================");

    console.log("");

    // ========================================================
    // 1. Читаем файл
    // ========================================================

    console.log("📖 Чтение economy_data.sii...");

    const content = readFile();

    const parsedCurrencies = parseCurrencies(content);

    console.log(`   Найдено валют в файле: ${parsedCurrencies.length}`);

    // ========================================================
    // 2. Проверяем структуру файла
    // ========================================================

    console.log("🔍 Проверка списка валют...");

    validateFileCurrencies(parsedCurrencies);

    console.log("   ✅ Все необходимые валюты присутствуют");

    // ========================================================
    // 3. Получаем курсы
    // ========================================================

    const latestRates = await fetchLatestRates();

    console.log(`   Получено курсов: ${Object.keys(latestRates).length}`);

    // ========================================================
    // 4. Проверяем курсы
    // ========================================================

    console.log("🔍 Проверка полученных курсов...");

    validateRates(latestRates);

    console.log("   ✅ Все необходимые курсы получены");

    // ========================================================
    // 5. Показываем изменения
    // ========================================================

    printRates(parsedCurrencies, latestRates);

    // ========================================================
    // 6. Формируем новый файл
    // ========================================================

    console.log("🔧 Подготовка обновлённого файла...");

    const updatedContent = updateContent(
      content,
      parsedCurrencies,
      latestRates,
    );

    // ========================================================
    // 7. Создаём backup
    // ========================================================

    createBackup();

    // ========================================================
    // 8. Записываем economy_data.sii
    // ========================================================

    fs.writeFileSync(FILE_PATH, updatedContent, "utf-8");

    console.log("✅ economy_data.sii успешно обновлён");

    // ========================================================
    // 9. Сохраняем лог
    // ========================================================

    saveLogs(parsedCurrencies, latestRates);

    console.log("");

    console.log("🎉 Обновление валют ETS2 завершено!");

    console.log("");
  } catch (error) {
    console.error("");

    console.error("❌ ОШИБКА:", error.message);

    console.error("");

    console.error("⚠️ Файл economy_data.sii НЕ изменён.");

    console.error("");

    process.exitCode = 1;
  }
}

// ============================================================

main();
