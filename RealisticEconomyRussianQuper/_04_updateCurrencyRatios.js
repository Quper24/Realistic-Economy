const fs = require("fs");
const path = require("path");
const axios = require("axios");

// ============================================================
// НАСТРОЙКИ
// ============================================================

// Путь к economy_data.sii
const FILE_PATH = path.join(__dirname, "def", "economy_data.sii");

// Базовая валюта API
const BASE_CURRENCY = "EUR";

// ============================================================
// FIX_COEF
// ============================================================
//
// ЭТОТ КОЭФФИЦИЕНТ ВЫ ЗАДАЁТЕ ВРУЧНУЮ.
//
// Пример:
// const FIX_COEF = 100 / 97.78;
//
// ============================================================

const FIX_COEF = 100 / 97.78;

// ============================================================
// ВАЛЮТЫ, КОТОРЫЕ ОБНОВЛЯЕМ
// ============================================================
//
// BGN / BGN* здесь НЕТ.
// Болгарию полностью игнорируем.
//
// EUR также не нужно получать через API,
// потому что EUR является базовой валютой.
//
// RUB устанавливается отдельно = 100.
// ============================================================

const CURRENCIES_TO_UPDATE = [
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
// ВАЛЮТЫ, КОТОРЫЕ ДОЛЖНЫ БЫТЬ В ФАЙЛЕ
// ============================================================
//
// BGN / BGN* намеренно отсутствуют.
// Они могут быть в файле, но их наличие не проверяется.
//
// Это позволяет работать как с:
//
// BGN
//
// так и с:
//
// BGN*
// ============================================================

const REQUIRED_FILE_CURRENCIES = ["EUR", ...CURRENCIES_TO_UPDATE];

// ============================================================
// КОДЫ, КОТОРЫЕ НУЖНО ИГНОРИРОВАТЬ
// ============================================================

const IGNORED_CURRENCIES = ["BGN", "BGN*"];

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
// ПАРСИНГ ВАЛЮТ
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

      console.log(`Код валюты: ${code}, ` + `текущий коэффициент: ${ratio}`);

      i += 2;
    } else {
      i++;
    }
  }

  return result;
}

// ============================================================
// ПРОВЕРКА ВАЛЮТ В ФАЙЛЕ
// ============================================================

function validateFileCurrencies(currencyData) {
  const fileCurrencies = currencyData.map((item) => item.code);

  // Проверяем только валюты, которые реально
  // должны обновляться.
  const missing = REQUIRED_FILE_CURRENCIES.filter(
    (currency) => !fileCurrencies.includes(currency),
  );

  if (missing.length > 0) {
    throw new Error(
      `В economy_data.sii отсутствуют валюты: ${missing.join(", ")}`,
    );
  }

  console.log("   ✅ Все необходимые валюты присутствуют");

  // Информация о Болгарии
  const bgnCurrency = fileCurrencies.find(
    (currency) => currency === "BGN" || currency === "BGN*",
  );

  if (bgnCurrency) {
    console.log(
      `   🇧🇬 ${bgnCurrency} обнаружена — будет полностью проигнорирована`,
    );
  } else {
    console.log("   🇧🇬 BGN/BGN* в файле нет — ничего страшного");
  }
}

// ============================================================
// ПОЛУЧЕНИЕ АКТУАЛЬНЫХ КУРСОВ
// ============================================================

async function fetchLatestRates() {
  console.log("🌐 Загрузка актуальных курсов валют...");

  console.log(`   Базовая валюта: ${BASE_CURRENCY}`);

  console.log(`   Валют к загрузке: ${CURRENCIES_TO_UPDATE.length}`);

  const quotes = CURRENCIES_TO_UPDATE.join(",");

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

function validateRates(rates) {
  const missing = [];

  for (const currency of CURRENCIES_TO_UPDATE) {
    if (rates[currency] === undefined || !Number.isFinite(rates[currency])) {
      missing.push(currency);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Не получены курсы валют: ${missing.join(", ")}`);
  }

  console.log("   ✅ Все необходимые курсы получены");
}

// ============================================================
// РАСЧЁТ НОВОГО КОЭФФИЦИЕНТА
// ============================================================

function calculateRate(code, apiRate) {
  // RUB всегда = 100
  if (code === "RUB") {
    return "100.00";
  }

  // Остальные валюты:
  //
  // API rate × FIX_COEF
  //
  const calculated = apiRate * FIX_COEF;

  return calculated.toFixed(2);
}

// ============================================================
// ОБНОВЛЕНИЕ economy_data.sii
// ============================================================

function updateContent(content, currencyData, latestRates) {
  const lines = content.split(/\r?\n/);

  for (const entry of currencyData) {
    const { code, ratioLine } = entry;

    // ========================================================
    // BGN / BGN* ПОЛНОСТЬЮ ИГНОРИРУЕМ
    // ========================================================

    if (IGNORED_CURRENCIES.includes(code)) {
      console.log(`Код валюты: ${code}, ` + `пропуск — значение не изменяется`);

      continue;
    }

    // ========================================================
    // EUR не изменяем
    // ========================================================

    if (code === "EUR") {
      console.log("Код валюты: EUR, пропуск — базовая валюта = 1");

      continue;
    }

    // ========================================================
    // Получаем курс API
    // ========================================================

    const apiRate = latestRates[code];

    if (apiRate === undefined) {
      continue;
    }

    // ========================================================
    // Рассчитываем новый коэффициент
    // ========================================================

    const newRate = calculateRate(code, apiRate);

    console.log(
      `Код валюты: ${code}, ` +
        `API: ${apiRate}, ` +
        `FIX_COEF: ${FIX_COEF}, ` +
        `новый коэффициент: ${newRate}`,
    );

    // ========================================================
    // Записываем в файл
    // ========================================================

    lines[ratioLine] = `\tcurrency_ratio[]: ${newRate}`;
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
// СОХРАНЕНИЕ ЛОГА
// ============================================================

function saveLogs(currencyData, latestRates) {
  const logPath = path.join(__dirname, "currency-update.log");

  const now = new Date();

  const lines = [];

  lines.push("============================================================");

  lines.push(`Обновление валют: ${now.toISOString()}`);

  lines.push(`BASE_CURRENCY: ${BASE_CURRENCY}`);

  lines.push(`FIX_COEF: ${FIX_COEF}`);

  lines.push("============================================================");

  for (const entry of currencyData) {
    const { code, ratio } = entry;

    // BGN / BGN*
    if (IGNORED_CURRENCIES.includes(code)) {
      lines.push(
        `${code.padEnd(5)} | ` +
          `${String(ratio).padStart(10)} -> ` +
          `${String(ratio).padStart(10)} | ` +
          `НЕ ИЗМЕНЯЕТСЯ`,
      );

      continue;
    }

    // EUR
    if (code === "EUR") {
      lines.push(
        `${code.padEnd(5)} | ` +
          `${String(ratio).padStart(10)} -> ` +
          `${String(ratio).padStart(10)} | ` +
          `БАЗОВАЯ ВАЛЮТА`,
      );

      continue;
    }

    const apiRate = latestRates[code];

    if (apiRate === undefined) {
      continue;
    }

    const newRate = calculateRate(code, apiRate);

    const numericNewRate = parseFloat(newRate);

    const difference = numericNewRate - ratio;

    const percent = ratio !== 0 ? (difference / ratio) * 100 : 0;

    lines.push(
      `${code.padEnd(5)} | ` +
        `${String(ratio).padStart(10)} -> ` +
        `${newRate.padStart(10)} | ` +
        `${percent >= 0 ? "+" : ""}` +
        `${percent.toFixed(2)}%`,
    );
  }

  lines.push("");

  fs.appendFileSync(logPath, lines.join("\n"), "utf-8");

  console.log(`📝 Лог обновления: ${logPath}`);
}

// ============================================================
// ОСНОВНАЯ ФУНКЦИЯ
// ============================================================

async function main() {
  try {
    console.log("");

    console.log("============================================================");

    console.log("🚛 ETS2 CURRENCY UPDATER");

    console.log("============================================================");

    console.log("");

    console.log(`⚙️ FIX_COEF = ${FIX_COEF}`);

    console.log("");

    // ========================================================
    // 1. Читаем файл
    // ========================================================

    console.log("📖 Чтение economy_data.sii...");

    const content = readFile();

    const parsedCurrencies = parseCurrencies(content);

    console.log(`   Найдено валют в файле: ${parsedCurrencies.length}`);

    console.log("");

    // ========================================================
    // 2. Проверяем список валют
    // ========================================================

    console.log("🔍 Проверка списка валют...");

    validateFileCurrencies(parsedCurrencies);

    console.log("");

    // ========================================================
    // 3. Загружаем курсы
    // ========================================================

    const latestRates = await fetchLatestRates();

    console.log(`   Получено курсов: ${Object.keys(latestRates).length}`);

    console.log("");

    // ========================================================
    // 4. Проверяем курсы
    // ========================================================

    console.log("🔍 Проверка полученных курсов...");

    validateRates(latestRates);

    console.log("");

    // ========================================================
    // 5. Рассчитываем новые значения
    // ========================================================

    console.log("🔧 Расчёт новых коэффициентов...");

    const updatedContent = updateContent(
      content,
      parsedCurrencies,
      latestRates,
    );

    console.log("");

    // ========================================================
    // 6. Создаём backup
    // ========================================================

    createBackup();

    // ========================================================
    // 7. Записываем файл
    // ========================================================

    fs.writeFileSync(FILE_PATH, updatedContent, "utf-8");

    console.log("✅ Курсы валют успешно обновлены в файле economy_data.sii");

    // ========================================================
    // 8. Сохраняем лог
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
