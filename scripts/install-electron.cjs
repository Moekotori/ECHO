const path = require('node:path');

process.env.electron_config_cache =
  process.env.electron_config_cache || path.resolve(__dirname, '..', '.electron-cache');

require('electron/install');
