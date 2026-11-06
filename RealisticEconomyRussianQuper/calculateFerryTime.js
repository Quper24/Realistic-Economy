const fs = require("fs");
const path = require("path");

// Функция для расчета времени парома
function calculateFerryTime(distance) {
  const maxSpeed = 30; // км/ч (крейсерская скорость)
  const acceleration = 0.2; // м/с² (ускорение и торможение)

  const minTime = 20; // Минимальное время парома: 20 минут

  // Перевод скорости в м/с
  const maxSpeedMS = (maxSpeed * 1000) / 3600;

  // Расчет расстояния разгона и торможения (s = v² / 2a)
  const accelDistance = maxSpeedMS ** 2 / (2 * acceleration) / 1000; // км

  // Время разгона и торможения (t = v / a)
  const accelTime = maxSpeedMS / acceleration / 60; // в минутах

  // Проверка, достаточно ли расстояния для выхода на крейсерскую скорость
  if (distance <= 2 * accelDistance) {
    // Если расстояние слишком мало, то считаем,
    // что паром не достигает крейсерской скорости
    const adjustedTime = Math.sqrt((2 * distance * 1000) / acceleration) / 60;

    // Минимальное время — 20 минут
    return Math.max(minTime, Math.round(adjustedTime));
  }

  // Расстояние на крейсерской скорости
  const cruiseDistance = distance - 2 * accelDistance;

  // Время на крейсерской скорости (t = s / v)
  const cruiseTime = (cruiseDistance / maxSpeed) * 60;

  // Итоговое время
  const totalTime = accelTime * 2 + cruiseTime;

  // Минимальное время — 20 минут
  return Math.round(minTime + totalTime);
}

// Функция для расчета цены
function calculatePrice(time) {
  const minPrice = 5; // Минимальная цена: $2
  const pricePer30Minutes = 3; // +$3 за каждые следующие 30 минут

  // Первый час стоит $2
  // Каждые следующие 30 минут добавляют $1
  const additionalIntervals = Math.max(0, Math.ceil((time - 60) / 30));

  return minPrice + additionalIntervals * pricePer30Minutes;
}

// Чтение и обновление файлов
function processSiiFiles(directory) {
  // Получаем список всех файлов в текущей директории
  fs.readdir(directory, (err, files) => {
    if (err) {
      console.error("Ошибка при чтении директории:", err);
      return;
    }

    // Фильтруем только файлы с расширением .sii
    const siiFiles = files.filter(
      (file) => path.extname(file).toLowerCase() === ".sii",
    );

    // Обрабатываем каждый файл
    siiFiles.forEach((file) => {
      const filePath = path.join(directory, file);

      // Читаем содержимое файла
      fs.readFile(filePath, "utf8", (err, data) => {
        if (err) {
          console.error(`Ошибка при чтении файла ${file}:`, err);
          return;
        }

        // Ищем distance независимо от пробелов:
        // distance: 1
        // distance : 1
        // distance  :    1
        const distanceMatch = data.match(/distance\s*:\s*(\d+(?:\.\d+)?)/);

        if (!distanceMatch) {
          console.warn(`В файле ${file} не найдено значение distance`);
          return;
        }

        const distance = parseFloat(distanceMatch[1]);

        if (isNaN(distance)) {
          console.warn(`Некорректное значение distance в файле ${file}`);
          return;
        }

        // Вычисляем новые значения time и price
        const newTime = calculateFerryTime(distance);
        const newPrice = calculatePrice(newTime);

        // Обновляем price, независимо от количества пробелов
        let updatedData = data.replace(/price\s*:\s*\d+/, `price: ${newPrice}`);

        // Обновляем time, независимо от количества пробелов
        updatedData = updatedData.replace(/time\s*:\s*\d+/, `time: ${newTime}`);

        // Нормализуем distance:
        // distance : 1 -> distance: 1
        // distance  :    1 -> distance: 1
        updatedData = updatedData.replace(
          /distance\s*:\s*(\d+(?:\.\d+)?)/,
          `distance: ${distanceMatch[1]}`,
        );

        // Сохраняем обновленные данные обратно в файл
        fs.writeFile(filePath, updatedData, "utf8", (err) => {
          if (err) {
            console.error(`Ошибка при записи файла ${file}:`, err);
            return;
          }

          console.log(
            `Файл ${file} успешно обновлен. ` +
              `distance = ${distance}, ` +
              `price = ${newPrice}, ` +
              `time = ${newTime}`,
          );
        });
      });
    });
  });
}

// Запускаем обработку файлов
processSiiFiles(path.join(__dirname, "def", "ferry", "connection"));
