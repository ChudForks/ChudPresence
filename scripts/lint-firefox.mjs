import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageFolderName } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const args = process.argv.slice(2);
const target = args[0] === '--production' ? 'firefox-production' : 'firefox';
if (target === 'firefox-production') args.shift();
const source = path.join(root, 'dist', packageFolderName(target, version));
// This is the same Mozilla validator used by web-ext and AMO. Invoke it directly
// so linting needs neither web-ext's device-control dependencies nor Android tools.
const executable = path.join(path.dirname(fileURLToPath(import.meta.resolve('addons-linter/package.json'))), 'bin', 'addons-linter');
await fs.access(path.join(source, 'manifest.json'));
const result = spawnSync(process.execPath, [executable, source, '--warnings-as-errors', ...args], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
