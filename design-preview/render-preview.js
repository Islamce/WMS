const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.resolve(__dirname, 'index.html')}`);
  await page.screenshot({ path: path.resolve(__dirname, 'kynox-redesign-preview-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.resolve(__dirname, 'kynox-redesign-preview-mobile.png'), fullPage: true });
  await browser.close();
})();
