import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const checks = [];

const commandVersion = (command, args = ['--version']) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim().split(/\r?\n/, 1)[0];
  } catch {
    return null;
  }
};

const parseVersion = (value) => {
  const match = value?.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? match.slice(1).map((part) => Number(part ?? 0)) : null;
};

const atLeast = (version, required) => {
  for (let index = 0; index < required.length; index += 1) {
    if ((version[index] ?? 0) > required[index]) return true;
    if ((version[index] ?? 0) < required[index]) return false;
  }
  return true;
};

const add = (name, ok, detail, fix = '') => checks.push({ name, ok, detail, fix });

const nodeVersion = parseVersion(process.versions.node);
add(
  'Node.js',
  nodeVersion?.[0] === 22 && atLeast(nodeVersion, [22, 23, 0]),
  process.version,
  'Install Node.js 22.23+ (the repository pins 22.23.1 in .nvmrc and .node-version)',
);

const npmOutput = process.env.npm_execpath
  ? commandVersion(process.execPath, [process.env.npm_execpath, '--version'])
  : process.platform === 'win32'
    ? commandVersion(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm --version'])
    : commandVersion('npm');
const npmVersion = parseVersion(npmOutput);
add(
  'npm',
  npmVersion?.[0] === 10,
  npmOutput ?? 'not found',
  'Use npm 10; package.json pins npm 10.8.2 for Volta/Corepack-aware tools',
);

const pythonOutput = commandVersion(process.platform === 'win32' ? 'py.exe' : 'python3')
  ?? commandVersion('python');
const pythonVersion = parseVersion(pythonOutput);
add(
  'Python',
  pythonVersion?.[0] === 3,
  pythonOutput ?? 'not found',
  'Install Python 3.12+ for node-gyp and native dependencies',
);

const cmakeCandidates = process.platform === 'win32'
  ? ['cmake.exe', 'C:\\Program Files\\CMake\\bin\\cmake.exe']
  : ['cmake'];
const cmakeOutput = cmakeCandidates.map((command) => commandVersion(command)).find(Boolean) ?? null;
const cmakeVersion = parseVersion(cmakeOutput);
add(
  'CMake',
  Boolean(cmakeVersion && atLeast(cmakeVersion, [3, 24, 0])),
  cmakeOutput ?? 'not found',
  'Install CMake 3.24+',
);

if (process.platform === 'win32') {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  let visualStudio = null;
  if (existsSync(vswhere)) {
    try {
      visualStudio = execFileSync(vswhere, [
        '-latest',
        '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-property', 'installationPath',
      ], { encoding: 'utf8', windowsHide: true }).trim();
    } catch {
      visualStudio = null;
    }
  }
  add(
    'MSVC / Windows SDK',
    Boolean(visualStudio),
    visualStudio || 'not found',
    'Install Visual Studio 2022 Build Tools with Desktop development with C++',
  );
}

console.log('\nECHO development environment\n');
for (const check of checks) {
  console.log(`${check.ok ? '[OK]' : '[MISSING]'} ${check.name}: ${check.detail}${check.ok ? '' : `\n  Fix: ${check.fix}`}`);
}

const missing = checks.filter((check) => !check.ok);
if (missing.length) {
  if (process.platform === 'win32') {
    console.log('\nWindows install commands for the missing items:');
    if (missing.some((check) => check.name === 'Node.js' || check.name === 'npm')) {
      console.log('winget install Volta.Volta');
      console.log('# Reopen PowerShell, then:');
      console.log('volta install node@22.23.1 npm@10.8.2');
    }
    if (missing.some((check) => check.name === 'Python')) {
      console.log('winget install Python.Python.3.12');
    }
    if (missing.some((check) => check.name === 'CMake')) {
      console.log('winget install Kitware.CMake');
    }
    if (missing.some((check) => check.name === 'MSVC / Windows SDK')) {
      console.log('winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"');
    }
  }
  console.log('\nAfter installing missing tools, reopen the terminal and run npm run setup again.');
  process.exitCode = 1;
} else {
  console.log('\nEnvironment ready.');
}
