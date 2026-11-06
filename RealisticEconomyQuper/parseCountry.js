const fs = require("fs");
const path = require("path");

const inputDir = "./def/country"; // Путь к папке с файлами
const outputFile = "./countries.json"; // Результирующий файл

function parseCountryFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");

  const nameMatch = content.match(/name:\s*"([^"]+)"/);
  const priceMatch = content.match(/fuel_price:\s*([\d.]+)/);

  if (!nameMatch || !priceMatch) return null;

  const filename = path.basename(filePath); // например: russia.sii
  const filenameNoExt = path.parse(filename).name; // например: russia
  const nameEn = filenameNoExt.charAt(0).toUpperCase() + filenameNoExt.slice(1); // Russia

  return {
    name: nameMatch[1],
    price: parseFloat(priceMatch[1]),
    filename,
    name_en: nameEn,
  };
}

function main() {
  let results = [];

  const files = fs
    .readdirSync(inputDir)
    .filter((file) => /\.(sii|sui)$/i.test(file));

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    const countryData = parseCountryFile(filePath);
    if (countryData) {
      results.push(countryData);
    }
  }

  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), "utf-8");
  console.log(`Сохранено ${results.length} записей в ${outputFile}`);
}

main();
