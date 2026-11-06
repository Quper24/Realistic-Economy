const fs = require("fs");
const path = require("path");

// Пути к файлам
const dieselPath = path.resolve(__dirname, "diesel_prices.json");
const countriesPath = path.resolve(__dirname, "countries.json");

// Чтение JSON-файлов
const dieselData = JSON.parse(fs.readFileSync(dieselPath, "utf8"));
const countriesData = JSON.parse(fs.readFileSync(countriesPath, "utf8"));

// Создаём Map для быстрого поиска цен по name_en
const priceMap = new Map();
dieselData.forEach((entry) => {
  if (entry.name_en) {
    priceMap.set(entry.name_en.trim().toLowerCase(), entry.price);
  }
});

// Обновляем цены в countries.json
const updatedCountries = countriesData.map((country) => {
  const dieselPrice = priceMap.get(country.name_en.trim().toLowerCase());
  return {
    ...country,
    price: dieselPrice !== undefined ? dieselPrice : country.price,
  };
});

// Перезаписываем файл countries.json с обновлёнными ценами
fs.writeFileSync(
  countriesPath,
  JSON.stringify(updatedCountries, null, 2),
  "utf8",
);

console.log("✅ Цены успешно обновлены и сохранены в countries.json");
