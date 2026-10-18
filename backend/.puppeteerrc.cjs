const { join } = require('path');

module.exports = {
  // Obligamos a que Chrome se descargue y se guarde DENTRO del proyecto
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};