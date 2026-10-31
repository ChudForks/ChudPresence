import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildPackages, loadPackageManifest, packageFolderName } from '../scripts/build.mjs';

const productionId = 'chudpresence@chudforks';

async function fixture(t) {
  const tempRoot = path.resolve(os.tmpdir());
  const root = await fs.mkdtemp(path.join(tempRoot, 'chudpresence-production-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), tempRoot);
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, 'extension'), { recursive: true });
  await fs.mkdir(path.join(root, 'ChudPresence-Firefox/extension'), { recursive: true });
  for (const name of ['extension/manifest.json', 'ChudPresence-Firefox/extension/manifest.json', 'ChudPresence-Firefox/production.json']) {
    await fs.copyFile(new URL(`../${name}`, import.meta.url), path.join(root, name));
  }
  const { version } = await loadPackageManifest('chromium', root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version }));
  await fs.writeFile(path.join(root, 'extension/background.js'), '// shared runtime fixture');
  await fs.writeFile(path.join(root, 'ChudPresence-Firefox/extension/background.html'), '<script type="module" src="background.js"></script>');
  return root;
}

test('the permanent Firefox identity changes only the name and ID and preserves the development manifest', async () => {
  const development = await loadPackageManifest('firefox');
  const production = await loadPackageManifest('firefox-production');
  assert.equal(production.name, 'ChudPresence');
  assert.equal(production.browser_specific_settings.gecko.id, productionId);
  assert.equal(development.browser_specific_settings.gecko.id, 'chudpresence-firefox-development@chudforks.local');
  production.name = development.name;
  production.browser_specific_settings.gecko.id = development.browser_specific_settings.gecko.id;
  assert.deepEqual(production, development);
  assert.deepEqual(await loadPackageManifest('firefox'), development);
});

test('building the production candidate preserves the existing development package and shares its runtime', async t => {
  const sourceRoot = await fixture(t);
  const [development] = await buildPackages('firefox', { sourceRoot });
  const originalDevelopment = await fs.readFile(development.archive);
  const [production] = await buildPackages('firefox-production', { sourceRoot });
  assert.match(production.archive, /-unsigned-production\.xpi$/);
  assert.notEqual(production.archive, development.archive);
  assert.deepEqual(await fs.readFile(development.archive), originalDevelopment);
  const packagedManifest = JSON.parse(await fs.readFile(path.join(production.staged, 'manifest.json'), 'utf8'));
  assert.equal(packagedManifest.browser_specific_settings.gecko.id, productionId);
  assert.equal(packagedManifest.name, 'ChudPresence');
  for (const filename of ['background.js', 'background.html']) {
    assert.deepEqual(await fs.readFile(path.join(production.staged, filename)), await fs.readFile(path.join(development.staged, filename)));
  }
});

test('production profiles reject duplicate identities, malformed IDs, and unrelated manifest changes', async t => {
  const root = await fixture(t);
  const development = await loadPackageManifest('firefox', root);
  for (const profile of [
    { name: 'ChudPresence', id: development.browser_specific_settings.gecko.id },
    { name: 'ChudPresence', id: 'invalid id' },
    { name: 'ChudPresence', id: productionId, permissions: ['tabs'] },
    { name: '', id: productionId },
  ]) {
    await fs.writeFile(path.join(root, 'ChudPresence-Firefox/production.json'), JSON.stringify(profile));
    await assert.rejects(loadPackageManifest('firefox-production', root), /profile|identities|invalid/);
  }
  assert.throws(() => packageFolderName('firefox-production', '../../outside'), /numeric extension version/);
});
