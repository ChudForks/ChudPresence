import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const chromium = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const firefox = JSON.parse(await readFile(new URL('../ChudPresence-Firefox/extension/manifest.json', import.meta.url), 'utf8'));

test('Firefox declares its actual native Activity runtime requirements and an explicit add-on identity', () => {
  assert.equal(firefox.manifest_version, 3);
  assert.equal(firefox.version, chromium.version);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, '153.0');
  assert.match(firefox.browser_specific_settings.gecko.id, /\S/);
  assert.ok(firefox.optional_permissions.includes('userScripts'));
  assert.ok(!firefox.permissions.includes('offscreen'));
  assert.equal(firefox.minimum_chrome_version, undefined);
});

test('Firefox preserves the shared UI, site permissions, and WebAssembly isolation policy', () => {
  assert.deepEqual(firefox.action, chromium.action);
  assert.deepEqual(firefox.icons, chromium.icons);
  assert.deepEqual(firefox.host_permissions, chromium.host_permissions);
  assert.deepEqual(firefox.optional_host_permissions, chromium.optional_host_permissions);
  assert.equal(firefox.content_security_policy.extension_pages, chromium.content_security_policy.extension_pages);
  assert.match(firefox.content_security_policy.extension_pages, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(firefox.content_security_policy.extension_pages, /(?:^|\s)'unsafe-eval'(?:\s|;|$)/);
});

test('Firefox uses an event background page with the shared module entry', async () => {
  assert.equal(firefox.background.page, 'background.html');
  assert.equal(firefox.background.persistent, false);
  assert.equal(firefox.background.service_worker, undefined);
  const background = await readFile(new URL('../ChudPresence-Firefox/extension/background.html', import.meta.url), 'utf8');
  assert.match(background, /<script\b[^>]*type=["']module["'][^>]*src=["']background\.js["']/);
});
