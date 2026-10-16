import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const source = path.join(root, 'dist', `ChudPresence-Firefox-${version}-unsigned-development`);
// This is the same Mozilla validator used by web-ext and AMO. Invoke it directly
// so linting needs neither web-ext's device-control dependencies nor Android tools.
const executable = path.join(path.dirname(fileURLToPath(import.meta.resolve('addons-linter/package.json'))), 'bin', 'addons-linter');
await fs.access(path.join(source, 'manifest.json'));
const result = spawnSync(process.execPath, [executable, source, '--warnings-as-errors', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
