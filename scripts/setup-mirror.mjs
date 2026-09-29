import { execFileSync } from 'node:child_process';

const registry = 'https://registry.npmmirror.com';
const electronMirror = 'https://npmmirror.com/mirrors/electron/';
const builderMirror = 'https://npmmirror.com/mirrors/electron-builder-binaries/';

if (process.env.npm_execpath) {
  execFileSync(process.execPath, [process.env.npm_execpath, 'config', 'set', 'registry', registry], { stdio: 'inherit' });
} else if (process.platform === 'win32') {
  execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm config set registry ${registry}`], { stdio: 'inherit' });
} else {
  execFileSync('npm', ['config', 'set', 'registry', registry], { stdio: 'inherit' });
}

for (const [name, value] of [['ELECTRON_MIRROR', electronMirror], ['ELECTRON_BUILDER_BINARIES_MIRROR', builderMirror]]) {
  process.env[name] = value;
  if (process.platform === 'win32') {
    // Persist for future PowerShell sessions; the current npm process also gets it above.
    const { execFileSync: setx } = await import('node:child_process');
    setx('setx.exe', [name, value], { stdio: 'ignore', windowsHide: true });
  }
  console.log(`${name}=${value}`);
}

console.log(`npm registry=${registry}`);
console.log('\n已配置 npm 与 Electron 镜像。请重新打开终端后继续 npm install。');
