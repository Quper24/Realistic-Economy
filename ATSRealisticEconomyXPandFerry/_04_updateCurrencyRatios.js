const fs = require("fs");
const path = require("path");
const axios = require("axios");

// ============================================================
// НАСТРОЙКИ
// ============================================================

// Путь к economy_data.sii
const FILE_PATH = path.join(__dirname, "def", "economy_data.sii");

// Базовая валюта
const BASE_CURRENCY = "USD";

// Валюты, которые должны присутствовать в economy_data.sii
const CURRENCIES_TO_UPDATE = [
  "USD",
  "CAD",
  "MXN",
  "EUR",
  "RUB",
  "UAH",
  "KZT",
  "BYN",
  "CNY",
];

// Актуальный Frankfurter API v2
const API_URL =
  `https://api.frankfurter.dev/v2/rates` +
  `?base=${BASE_CURRENCY}` +
  `&quotes=${CURRENCIES_TO_UPDATE.filter((code) => code !== BASE_CURRENCY).join(
    ",",
  )}`;

// Таймаут запроса
const API_TIMEOUT = 10000;

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
  const lines = content.split("\n");

  const result = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith("currency_code[]")) {
      const codeMatch = line.match(/"([^"]+)"/);

      if (!codeMatch) {
        i++;
        continue;
      }

      const code = codeMatch[1];

      const ratioLine = lines[i + 1]?.trim();

      const ratioMatch = ratioLine?.match(/currency_ratio\[\]:\s*([\d.]+)/);

      const ratio = ratioMatch ? parseFloat(ratioMatch[1]) : 1;

      result.push({
        code,
        ratio,
        start: i,
        end: i + 1,
      });

      i += 2;
    } else {
      i++;
    }
  }

  return result;
}

// ============================================================
// ПОЛУЧЕНИЕ КУРСОВ FRANKFURTER
// ============================================================

async function fetchLatestRates() {
  console.log("🌐 Запрос курсов через Frankfurter API v2...");
  console.log(`🔗 ${API_URL}\n`);

  try {
    const response = await axios.get(API_URL, {
      timeout: API_TIMEOUT,

      headers: {
        "User-Agent": "Quper Economy Updater/1.0",
        Accept: "application/json",
      },
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!Array.isArray(response.data)) {
      throw new Error("API вернул данные в неожиданном формате");
    }

    // Frankfurter v2 возвращает:
    //
    // [
    //   {
    //     date: "2026-09-17",
    //     base: "USD",
    //     quote: "EUR",
    //     rate: 0.85
    //   },
    //   ...
    // ]

    const rates = {
      [BASE_CURRENCY]: 1,
    };

    for (const item of response.data) {
      if (
        item &&
        item.quote &&
        typeof item.rate === "number" &&
        Number.isFinite(item.rate)
      ) {
        rates[item.quote] = item.rate;
      }
    }

    console.log("📈 Курсы, полученные от API:");

    for (const code of CURRENCIES_TO_UPDATE) {
      if (rates[code] !== undefined) {
        console.log(`   ✅ ${code}: ${rates[code]}`);
      } else {
        console.log(`   ❌ ${code}: отсутствует`);
      }
    }

    return rates;
  } catch (error) {
    if (error.response) {
      console.error(`❌ Frankfurter HTTP ${error.response.status}`);

      if (error.response.data) {
        console.error(
          "Ответ API:",
          JSON.stringify(error.response.data, null, 2),
        );
      }
    } else {
      console.error(`❌ Frankfurter: ${error.code || error.message}`);
    }

    throw new Error("Не удалось получить курсы валют из Frankfurter API");
  }
}

// ============================================================
// ПРОВЕРКА ПОЛНОТЫ КУРСОВ
// ============================================================

function validateRates(rates) {
  const missingCurrencies = CURRENCIES_TO_UPDATE.filter(
    (code) =>
      rates[code] === undefined ||
      rates[code] === null ||
      !Number.isFinite(rates[code]),
  );

  if (missingCurrencies.length > 0) {
    console.error("\n❌ Не получены курсы для:");

    missingCurrencies.forEach((code) => {
      console.error(`   ❌ ${code}`);
    });

    return false;
  }

  return true;
}

// ============================================================
// ОБНОВЛЕНИЕ economy_data.sii
// ============================================================

function updateContent(content, currencyData, latestRates) {
  const lines = content.split("\n");

  let updatedCount = 0;

  for (const entry of currencyData) {
    const { code, start, ratio: oldRatio } = entry;

    const newRate = latestRates[code];

    if (newRate === undefined) {
      console.log(`⚠️ ${code}: курс не найден, значение не изменяется`);

      continue;
    }

    // Округляем до 2 знаков
    const roundedRate = parseFloat(newRate.toFixed(2));

    lines[start + 1] = `  currency_ratio[]: ${roundedRate}`;

    const change = oldRatio
      ? (((roundedRate - oldRatio) / oldRatio) * 100).toFixed(1)
      : "N/A";

    console.log(
      `   ${code}: ` +
        `${oldRatio.toFixed(2)} → ` +
        `${roundedRate.toFixed(2)} ` +
        `(${change}%)`,
    );

    updatedCount++;
  }

  console.log(`\n📊 Обновлено: ${updatedCount}/${currencyData.length} валют`);

  return lines.join("\n");
}

// ============================================================
// ПРОВЕРКА, ЧТО ВСЕ НУЖНЫЕ ВАЛЮТЫ ЕСТЬ В SII
// ============================================================

function validateFileCurrencies(currencyData) {
  const fileCurrencies = currencyData.map((item) => item.code);

  const missingCurrencies = CURRENCIES_TO_UPDATE.filter(
    (code) => !fileCurrencies.includes(code),
  );

  if (missingCurrencies.length > 0) {
    console.error("\n❌ В economy_data.sii отсутствуют валюты:");

    missingCurrencies.forEach((code) => {
      console.error(`   ❌ ${code}`);
    });

    return false;
  }

  return true;
}

// ============================================================
// СОЗДАНИЕ РЕЗЕРВНОЙ КОПИИ
// ============================================================

function createBackup() {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  const backupPath = `${FILE_PATH}.backup-${timestamp}`;

  fs.copyFileSync(FILE_PATH, backupPath);

  console.log(`💾 Создана резервная копия: ` + `${path.basename(backupPath)}`);

  return backupPath;
}

// ============================================================
// СОХРАНЕНИЕ ФАЙЛА
// ============================================================

function saveFile(content) {
  fs.writeFileSync(FILE_PATH, content, "utf-8");

  console.log("\n✅ Файл economy_data.sii успешно обновлен!");
}

// ============================================================
// СОХРАНЕНИЕ ЛОГОВ
// ============================================================

function saveLogs(rates, currencies) {
  const logDir = path.join(__dirname, "logs");

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, {
      recursive: true,
    });
  }

  const date = new Date().toISOString().slice(0, 10);

  const logPath = path.join(logDir, `exchange_rates_${date}.json`);

  const logData = {
    timestamp: new Date().toISOString(),

    baseCurrency: BASE_CURRENCY,

    source: "Frankfurter API v2",

    apiUrl: API_URL,

    rates,

    currencies: currencies.map((currency) => ({
      code: currency.code,

      oldRatio: currency.ratio,

      newRatio:
        rates[currency.code] !== undefined
          ? parseFloat(rates[currency.code].toFixed(2))
          : currency.ratio,
    })),
  };

  fs.writeFileSync(logPath, JSON.stringify(logData, null, 2), "utf-8");

  console.log(`📝 Логи сохранены: ` + `${path.basename(logPath)}`);
}

// ============================================================
// ОСНОВНАЯ ФУНКЦИЯ
// ============================================================

async function main() {
  try {
    console.log("📄 Чтение файла...");

    const content = readFile();

    console.log(`📂 Файл: ${FILE_PATH}`);

    // --------------------------------------------------------
    // Парсим существующие валюты
    // --------------------------------------------------------

    const parsedCurrencies = parseCurrencies(content);

    console.log(`💱 Найдено валют в файле: ` + `${parsedCurrencies.length}`);

    if (parsedCurrencies.length === 0) {
      throw new Error("В economy_data.sii не найдено ни одной валюты");
    }

    // --------------------------------------------------------
    // Проверяем наличие всех нужных валют в файле
    // --------------------------------------------------------

    if (!validateFileCurrencies(parsedCurrencies)) {
      throw new Error("В economy_data.sii отсутствуют необходимые валюты");
    }

    // --------------------------------------------------------
    // Получаем актуальные курсы
    // --------------------------------------------------------

    console.log(
      `\n🔄 Загрузка курсов валют ` + `(базовая: ${BASE_CURRENCY})...`,
    );

    console.log("=".repeat(60));

    const latestRates = await fetchLatestRates();

    console.log("=".repeat(60));

    // --------------------------------------------------------
    // Проверяем, что получили ВСЕ валюты
    // --------------------------------------------------------

    if (!validateRates(latestRates)) {
      throw new Error("Получены не все необходимые курсы. Файл НЕ изменён.");
    }

    // --------------------------------------------------------
    // Выводим итоговые курсы
    // --------------------------------------------------------

    console.log("\n📈 Актуальные курсы:");

    console.log("-".repeat(40));

    for (const code of CURRENCIES_TO_UPDATE) {
      console.log(`${code.padEnd(4)} = ` + `${latestRates[code]}`);
    }

    // --------------------------------------------------------
    // Формируем новый контент
    // --------------------------------------------------------

    console.log("\n🛠️ Подготовка изменений...");

    const updatedContent = updateContent(
      content,
      parsedCurrencies,
      latestRates,
    );

    // --------------------------------------------------------
    // Проверяем, что контент действительно изменился
    // --------------------------------------------------------

    if (updatedContent === content) {
      console.log("\nℹ️ Значения не изменились.");

      saveLogs(latestRates, parsedCurrencies);

      return;
    }

    // --------------------------------------------------------
    // Только теперь создаём backup
    // --------------------------------------------------------

    createBackup();

    // --------------------------------------------------------
    // Записываем новый файл
    // --------------------------------------------------------

    saveFile(updatedContent);

    // --------------------------------------------------------
    // Сохраняем лог
    // --------------------------------------------------------

    saveLogs(latestRates, parsedCurrencies);

    console.log("\n🎉 Готово!");
  } catch (error) {
    console.error("\n❌ Критическая ошибка:");

    console.error(error.message);

    if (error.stack) {
      console.error("\nStack:");

      console.error(error.stack);
    }

    console.error("\n⚠️ economy_data.sii НЕ был изменён.");

    // Важно для запуска из CI / bat / PowerShell:
    // сообщаем системе о неуспешном завершении.
    process.exitCode = 1;
  }
}

// ============================================================
// ЗАПУСК
// ============================================================

main();
