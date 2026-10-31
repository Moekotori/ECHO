const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'node_modules', 'better-sqlite3', 'package.json');
const sourceRoot = path.join(projectRoot, 'node_modules', 'better-sqlite3', 'src');

const replacements = [
  {
    file: path.join(sourceRoot, 'util', 'macros.cpp'),
    from: '#define OnlyAddon static_cast<Addon*>(info.Data().As<v8::External>()->Value())',
    to: [
      '#if defined(V8_MAJOR_VERSION) && V8_MAJOR_VERSION >= 14',
      '#define ECHO_EXTERNAL_VALUE(external) ((external)->Value(v8::kExternalPointerTypeTagDefault))',
      '#define ECHO_NEW_EXTERNAL(isolate, value) v8::External::New((isolate), (value), v8::kExternalPointerTypeTagDefault)',
      '#else',
      '#define ECHO_EXTERNAL_VALUE(external) ((external)->Value())',
      '#define ECHO_NEW_EXTERNAL(isolate, value) v8::External::New((isolate), (value))',
      '#endif',
      '#define OnlyAddon static_cast<Addon*>(ECHO_EXTERNAL_VALUE(info.Data().As<v8::External>()))',
    ].join('\n'),
  },
  {
    file: path.join(sourceRoot, 'better_sqlite3.cpp'),
    from: 'v8::Local<v8::External> data = v8::External::New(isolate, addon);',
    to: 'v8::Local<v8::External> data = ECHO_NEW_EXTERNAL(isolate, addon);',
  },
  {
    file: path.join(sourceRoot, 'util', 'helpers.cpp'),
    from: [
      '\trecv->InstanceTemplate()->SetNativeDataProperty(',
      '\t\tInternalizedFromLatin1(isolate, name),',
      '\t\tfunc,',
      '\t\t0,',
      '\t\tdata',
      '\t);',
    ].join('\n'),
    to: [
      '\trecv->InstanceTemplate()->SetNativeDataProperty(',
      '\t\tInternalizedFromLatin1(isolate, name),',
      '\t\tfunc,',
      '\t\tnullptr,',
      '\t\tdata',
      '\t);',
    ].join('\n'),
  },
];

if (!existsSync(packageJsonPath)) {
  process.exit(0);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
if (!/^12\./.test(String(packageJson.version))) {
  process.exit(0);
}

let changed = 0;

for (const replacement of replacements) {
  if (!existsSync(replacement.file)) {
    throw new Error(`Missing better-sqlite3 source file: ${replacement.file}`);
  }

  const source = readFileSync(replacement.file, 'utf8');
  if (source.includes(replacement.to)) {
    continue;
  }

  if (!source.includes(replacement.from)) {
    throw new Error(`Unable to apply better-sqlite3 Electron 42 patch to ${replacement.file}`);
  }

  writeFileSync(replacement.file, source.replace(replacement.from, replacement.to));
  changed += 1;
}

if (changed > 0) {
  console.log(`[patch:better-sqlite3] Applied Electron 42 V8 compatibility patch to ${changed} file(s).`);
}
