import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const hostPath = join(projectRoot, 'electron-app', 'build', 'echo-audio-host');
const toolsRoot = join(projectRoot, 'electron-app', 'tools-macos');
const toolsLib = join(toolsRoot, 'lib');
const hostRuntimeRoot = join(projectRoot, 'electron-app', 'build', 'macos-runtime');
const hostRuntimeLib = join(hostRuntimeRoot, 'lib');

const fail = (message) => {
  throw new Error(`[prepare:macos-runtime] ${message}`);
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8', shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed: ${String(result.stderr ?? result.stdout ?? '').trim()}`);
  }
  return String(result.stdout ?? '');
};

const resolveCommand = (command) => {
  const result = spawnSync('which', [command], { encoding: 'utf8', shell: false });
  return result.status === 0 ? result.stdout.trim() : null;
};

const parseDependencies = (filePath) => run('otool', ['-L', filePath])
  .split(/\r?\n/u)
  .slice(1)
  .map((line) => line.trim().replace(/\s+\(compatibility version.*$/u, ''))
  .filter(Boolean);

const isSystemDependency = (dependency) => dependency.startsWith('/usr/lib/')
  || dependency.startsWith('/System/')
  || dependency.startsWith('/System/Volumes/');

const copyDependencyTree = ({ rootFile, outputLib, rootKind }) => {
  const copied = new Map();
  const queue = [{ source: rootFile, kind: rootKind }];

  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependency of parseDependencies(current.source)) {
      if (isSystemDependency(dependency) || dependency.startsWith('@')) continue;
      if (!existsSync(dependency)) continue;
      const name = basename(dependency);
      const destination = join(outputLib, name);
      if (!existsSync(destination)) {
        copyFileSync(dependency, destination);
        chmodSync(destination, 0o755);
      }
      if (!copied.has(dependency)) {
        copied.set(dependency, { name, kind: current.kind });
        queue.push({ source: dependency, kind: 'library' });
      }
    }
  }

  return new Map([...copied.values()].map((value) => [value.name, value.kind]));
};

const patchMachO = (filePath, dependencyNames, rootKind) => {
  if (filePath.endsWith('.dylib')) {
    run('install_name_tool', ['-id', `@rpath/${basename(filePath)}`, filePath]);
  }
  for (const dependency of parseDependencies(filePath)) {
    const name = basename(dependency);
    if (!dependencyNames.has(name)) continue;
    const replacement = rootKind === 'host'
      ? `@loader_path/macos-runtime/lib/${name}`
      : rootKind === 'host-library' || rootKind === 'tools-library'
        ? `@loader_path/${name}`
        : `@loader_path/lib/${name}`;
    if (dependency !== replacement) {
      run('install_name_tool', ['-change', dependency, replacement, filePath]);
    }
  }
};

const resignAdhoc = (filePath) => {
  run('codesign', ['--force', '--sign', '-', filePath]);
};

try {
  if (process.platform !== 'darwin') fail(`requires macOS, got ${process.platform}`);
  if (process.arch !== 'arm64') fail(`requires arm64, got ${process.arch}`);
  if (!existsSync(hostPath)) fail(`missing native host: ${hostPath}; run npm run build:audio-host first`);

  const ffmpegPath = process.env.ECHO_FFMPEG_PATH
    ? resolve(projectRoot, process.env.ECHO_FFMPEG_PATH)
    : resolveCommand('ffmpeg');
  if (!ffmpegPath || !existsSync(ffmpegPath)) fail('missing ffmpeg; set ECHO_FFMPEG_PATH or install ffmpeg');

  if (parseDependencies(hostPath).some((dependency) => dependency.includes('macos-runtime'))) {
    run(process.execPath, [join(projectRoot, 'scripts', 'build-audio-host.mjs')]);
  }

  rmSync(toolsRoot, { recursive: true, force: true });
  rmSync(hostRuntimeRoot, { recursive: true, force: true });
  mkdirSync(toolsLib, { recursive: true });
  mkdirSync(hostRuntimeLib, { recursive: true });

  copyFileSync(ffmpegPath, join(toolsRoot, 'ffmpeg'));
  chmodSync(join(toolsRoot, 'ffmpeg'), 0o755);
  const ffmpegDeps = copyDependencyTree({ rootFile: ffmpegPath, outputLib: toolsLib, rootKind: 'tools' });
  const hostDeps = copyDependencyTree({ rootFile: hostPath, outputLib: hostRuntimeLib, rootKind: 'host' });
  const toolFiles = readdirSync(toolsLib).filter((name) => name.endsWith('.dylib'));
  const hostFiles = readdirSync(hostRuntimeLib).filter((name) => name.endsWith('.dylib'));
  const toolNames = new Set([...ffmpegDeps.keys(), ...toolFiles]);
  const hostNames = new Set([...hostDeps.keys(), ...hostFiles]);

  patchMachO(join(toolsRoot, 'ffmpeg'), toolNames, 'tools');
  for (const name of toolFiles) patchMachO(join(toolsLib, name), toolNames, 'tools-library');
  patchMachO(hostPath, hostNames, 'host');
  for (const name of hostFiles) patchMachO(join(hostRuntimeLib, name), hostNames, 'host-library');
  resignAdhoc(join(toolsRoot, 'ffmpeg'));
  for (const name of toolFiles) resignAdhoc(join(toolsLib, name));
  resignAdhoc(hostPath);
  for (const name of hostFiles) resignAdhoc(join(hostRuntimeLib, name));

  console.log(`[prepare:macos-runtime] ffmpeg=${ffmpegPath}`);
  console.log(`[prepare:macos-runtime] tools=${toolsRoot}`);
  console.log(`[prepare:macos-runtime] hostRuntime=${hostRuntimeRoot}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
