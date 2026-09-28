import Database from 'better-sqlite3';
import {mkdirSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const source=join(process.env.APPDATA,'ECHO NEXT'),target=resolve('.codex-artifacts/library-lag-20260928/user-data');
mkdirSync(target,{recursive:true});
for(const name of ['echo-library.sqlite','echo-playback-session.sqlite']){const db=new Database(join(source,name),{readonly:true,fileMustExist:true});await db.backup(join(target,name));db.close();}
copyFileSync(join(source,'echo-settings.json'),join(target,'echo-settings.json'));
console.log('Created consistent SQLite backup for isolated QA');
