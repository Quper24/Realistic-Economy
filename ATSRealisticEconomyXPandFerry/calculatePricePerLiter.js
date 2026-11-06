// Пример использования
const dieselPriceUSD = 5.955; // Цена за галлон в долларах
const conversionRate = 0.264172; // 1 галлон = 3.78541 литра (обратное значение)
const usdToEurRate = 0.85; // Курс доллара к евро

function convertFuelPrice(state, gallonPriceUSD = dieselPriceUSD) {
  const pricePerLitreUSD = gallonPriceUSD * conversionRate; // Перевод в литры
  const pricePerLitreEUR = pricePerLitreUSD * usdToEurRate; // Перевод в евро
  return {
    state,
    pricePerLitreUSD: pricePerLitreUSD.toFixed(3), // Цена в долларах за литр
    pricePerLitreEUR: pricePerLitreEUR.toFixed(3), // Цена в евро за литр
  };
}

const dieselPrices = convertFuelPrice(
  "тест",
  dieselPriceUSD,
  conversionRate,
  usdToEurRate,
);

console.log(convertFuelPrice("Alaska", 5.955))
console.log(convertFuelPrice("Alabama", 5.381))
console.log(convertFuelPrice("Arkansas", 5.133))
console.log(convertFuelPrice("Arizona", 5.994))
console.log(convertFuelPrice("California", 7.600))
console.log(convertFuelPrice("Colorado", 5.127))
console.log(convertFuelPrice("Connecticut", 5.884))
console.log(convertFuelPrice("District of Columbia", 5.842))
console.log(convertFuelPrice("Delaware", 5.748))
console.log(convertFuelPrice("Florida", 5.573))
console.log(convertFuelPrice("Georgia", 5.210))
console.log(convertFuelPrice("Hawaii", 7.148))
console.log(convertFuelPrice("Iowa", 5.037))
console.log(convertFuelPrice("Idaho", 5.501))
console.log(convertFuelPrice("Illinois", 5.410))
console.log(convertFuelPrice("Indiana", 5.410))
console.log(convertFuelPrice("Kansas", 4.745))
console.log(convertFuelPrice("Kentucky", 5.328))
console.log(convertFuelPrice("Louisiana", 5.205))
console.log(convertFuelPrice("Massachusetts", 5.848))
console.log(convertFuelPrice("Maryland", 5.806))
console.log(convertFuelPrice("Maine", 5.856))
console.log(convertFuelPrice("Michigan", 5.239))
console.log(convertFuelPrice("Minnesota", 5.079))
console.log(convertFuelPrice("Missouri", 4.874))
console.log(convertFuelPrice("Mississippi", 5.203))
console.log(convertFuelPrice("Montana", 4.992))
console.log(convertFuelPrice("North Carolina", 5.682))
console.log(convertFuelPrice("North Dakota", 4.865))
console.log(convertFuelPrice("Nebraska", 4.883))
console.log(convertFuelPrice("New Hampshire", 5.794))
console.log(convertFuelPrice("New Jersey", 5.802))
console.log(convertFuelPrice("New Mexico", 5.384))
console.log(convertFuelPrice("Nevada", 6.265))
console.log(convertFuelPrice("New York", 5.934))
console.log(convertFuelPrice("Ohio", 5.372))
console.log(convertFuelPrice("Oklahoma", 4.737))
console.log(convertFuelPrice("Oregon", 6.290))
console.log(convertFuelPrice("Pennsylvania", 6.041))
console.log(convertFuelPrice("Rhode Island", 5.763))
console.log(convertFuelPrice("South Carolina", 5.548))
console.log(convertFuelPrice("South Dakota", 4.826))
console.log(convertFuelPrice("Tennessee", 5.399))
console.log(convertFuelPrice("Texas", 5.222))
console.log(convertFuelPrice("Utah", 5.346))
console.log(convertFuelPrice("Virginia", 5.713))
console.log(convertFuelPrice("Vermont", 5.854))
console.log(convertFuelPrice("Washington", 6.923))
console.log(convertFuelPrice("Wisconsin", 4.949))
console.log(convertFuelPrice("West Virginia", 5.515))
console.log(convertFuelPrice("Wyoming", 5.064))