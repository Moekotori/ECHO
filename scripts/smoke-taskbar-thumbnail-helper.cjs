const { join } = require('node:path');
const { app } = require('electron');

app.whenReady().then(() => {
  const helper = require(process.env.ECHO_TASKBAR_THUMBNAIL_HELPER_PATH || join(process.cwd(), 'electron-app', 'build', 'echo-taskbar-thumbnail-helper.node'));
  const requiredExports = ['attach', 'setCover', 'setButtons', 'setButtonHandler', 'clear', 'detach'];
  const missing = requiredExports.filter((name) => typeof helper[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(`Missing native helper exports: ${missing.join(', ')}`);
  }
  for (const order of [null, 'sequential', 'shuffle', 'repeat-one']) {
    if (!helper.setButtons(false, false, false, false, order)) {
      throw new Error(`Failed to accept playback order: ${order}`);
    }
  }
  helper.detach();
  console.log('[smoke:taskbar-thumbnail-helper] Native addon loaded with the Electron ABI.');
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
