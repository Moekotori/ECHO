const { join } = require('node:path');
const { app } = require('electron');

app.whenReady().then(() => {
  const helper = require(join(process.cwd(), 'electron-app', 'build', 'echo-taskbar-thumbnail-helper.node'));
  const requiredExports = ['attach', 'setCover', 'setButtons', 'setButtonHandler', 'clear', 'detach'];
  const missing = requiredExports.filter((name) => typeof helper[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`Missing native helper exports: ${missing.join(', ')}`);
  }
  console.log('[smoke:taskbar-thumbnail-helper] Native addon loaded with the Electron ABI.');
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
