const fs = require("fs");
const path = require("path");

// Путь к папке с файлами стран
const countryDir = path.join(__dirname, "def", "country");

// Путь к JSON файлу
const jsonFilePath = path.join(__dirname, "countries.json");

function updateCountryFiles() {
  // Чтение JSON
  fs.readFile(jsonFilePath, "utf-8", (err, data) => {
    if (err) {
      console.error("Ошибка при чтении countries.json:", err);
      return;
    }

    let countries;
    try {
      countries = JSON.parse(data);
    } catch (parseErr) {
      console.error("Ошибка парсинга JSON:", parseErr);
      return;
    }

    // Обрабатываем каждую страну
    countries.forEach((country) => {
      console.log(country);
      const { filename, price } = country;
      console.log(filename, price);
      // Пробуем разные расширения: .sui и .sii
      const extensions = [".sii", ".sui"];
      let fileFound = false;
      for (const ext of extensions) {
        const filePath = path.join(
          countryDir,
          filename.replace(/\.(sui|sii)$/, "") + ext,
        );
        console.log(filePath);
        if (fs.existsSync(filePath)) {
          fileFound = true;
          let content = fs.readFileSync(filePath, "utf-8");

          // Меняем fuel_price
          const updatedContent = content.replace(
            /fuel_price:\s*[\d.,]+/i,
            `fuel_price: ${price.toString().replace(",", ".")}`,
          );

          fs.writeFileSync(filePath, updatedContent, "utf-8");
          console.log(`Обновлено: ${filePath} -> fuel_price: ${price}`);
          break;
        }
      }

      if (!fileFound) {
        console.warn(`Файл не найден для: ${filename} (.sui или .sii)`);
      }
    });
  });
}

// Запуск
updateCountryFiles();
