const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");

// URL к твоему локальному серверу
const url = "http://192.168.0.8:8080/";

// Путь для сохранения JSON
const outputFile = "./diesel_prices.json";

async function fetchAndParse() {
  try {
    // Загружаем HTML
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // ПАРСИНГ НАЗВАНИЙ СТРАН - убираем звёздочки (*)
    const names = [];
    $(".outsideTitleElement a").each((i, el) => {
      let name = $(el).text().trim();
      // Убираем звёздочки и лишние пробелы
      name = name.replace(/\*/g, "").trim();
      if (name) names.push(name);
    });

    console.log(`Найдено стран: ${names.length}`);
    console.log("Примеры названий (первые 5):", names.slice(0, 5));

    // ПАРСИНГ ЦЕН
    const prices = [];

    // Метод: Ищем все div внутри #graphic, которые содержат только число (цену)
    $("#graphic div").each((i, el) => {
      const element = $(el);
      const text = element.text().trim();

      // Проверяем, что это число с плавающей точкой
      const match = text.match(/^[\d]+\.[\d]{3}$/);
      if (match && !element.children().length) {
        const price = parseFloat(match[0]);
        if (!isNaN(price)) {
          prices.push(price);
        }
      }
    });

    console.log(`Найдено цен: ${prices.length}`);
    console.log("Примеры цен (первые 5):", prices.slice(0, 5));

    // Если цены не найдены, попробуем альтернативный метод
    if (prices.length === 0) {
      console.log("Пробуем альтернативный метод парсинга цен...");

      // Ищем элементы с абсолютным позиционированием
      $('[style*="position: absolute"]').each((i, el) => {
        const element = $(el);
        const text = element.text().trim();

        // Ищем числа вида 0.123, 1.234 и т.д.
        const match = text.match(/[\d]+\.[\d]{3}/);
        if (match) {
          const price = parseFloat(match[0]);
          if (!isNaN(price) && price > 0 && price < 10) {
            prices.push(price);
          }
        }
      });

      console.log(`Найдено цен (альтернативный метод): ${prices.length}`);
    }

    // Проверяем соответствие количества
    if (names.length !== prices.length) {
      console.warn(
        `⚠️ Несоответствие: стран ${names.length}, цен ${prices.length}`,
      );
      console.warn("Используем минимальное количество для парсинга");
    }

    // Формируем данные в нужном формате
    const minLength = Math.min(names.length, prices.length);
    const newData = [];

    for (let i = 0; i < minLength; i++) {
      const countryName = names[i];

      newData.push({
        name: countryName,
        name_en: countryName, // Тот же name, так как у нас английские названия
        price: prices[i],
      });
    }

    // Читаем старый JSON, если он есть
    let existingData = [];
    if (fs.existsSync(outputFile)) {
      try {
        const raw = fs.readFileSync(outputFile, "utf-8");
        existingData = JSON.parse(raw);
        console.log(`Загружено ${existingData.length} существующих записей`);
      } catch (e) {
        console.log("Не удалось загрузить существующий файл, создаем новый");
      }
    }

    // Обновляем существующие записи и добавляем новые
    const existingNames = new Set(existingData.map((item) => item.name));
    const updatedData = [...existingData];

    newData.forEach((newItem) => {
      const existingIndex = updatedData.findIndex(
        (item) => item.name === newItem.name,
      );

      if (existingIndex >= 0) {
        // Обновляем существующую запись
        updatedData[existingIndex] = {
          ...updatedData[existingIndex],
          price: newItem.price,
          lastUpdated: new Date().toISOString(),
        };
      } else {
        // Добавляем новую запись
        updatedData.push({
          ...newItem,
          lastUpdated: new Date().toISOString(),
        });
      }
    });

    // Сортируем по алфавиту для удобства
    updatedData.sort((a, b) => a.name.localeCompare(b.name));

    // Сохраняем результат
    fs.writeFileSync(outputFile, JSON.stringify(updatedData, null, 2), "utf-8");

    console.log(`\n✅ Обновление завершено!`);
    console.log(`Всего записей: ${updatedData.length}`);
    console.log(`Сохранено в: ${outputFile}`);

    // Проверяем конкретные страны
    console.log("\nПримеры обновленных данных:");

    // Андорра
    const andorra = updatedData.find(
      (item) =>
        item.name.includes("Andorra") ||
        item.name.toLowerCase().includes("andorra"),
    );
    if (andorra) {
      console.log(`- ${andorra.name}: ${andorra.price}`);
    } else {
      console.log("- Андорра не найдена");
    }

    // Исландия
    const iceland = updatedData.find(
      (item) =>
        item.name.includes("Iceland") ||
        item.name.toLowerCase().includes("iceland"),
    );
    if (iceland) {
      console.log(`- ${iceland.name}: ${iceland.price}`);
    }

    // США
    const usa = updatedData.find(
      (item) =>
        item.name.includes("USA") || item.name.toLowerCase().includes("usa"),
    );
    if (usa) {
      console.log(`- ${usa.name}: ${usa.price}`);
    }
  } catch (error) {
    console.error(
      "❌ Ошибка при загрузке или парсинге страницы:",
      error.message,
    );
    console.error("Стек ошибки:", error.stack);
  }
}

// Запускаем парсинг
fetchAndParse();
