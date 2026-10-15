import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { validateActivityV2, validateV2Metadata, matchActivityV2Page, validateV2Report } from '../../../schemas/activity-api-v2.js';

const directory = new URL('../', import.meta.url);
const configuration = validateActivityV2(await fs.readFile(new URL('activity.json', directory), 'utf8'));

test('Roblox package declares the requested browsing and experience states without a player', async () => {
  const metadata = validateV2Metadata(JSON.parse(await fs.readFile(new URL('metadata.json', directory), 'utf8')));
  assert.equal(metadata.id, 'roblox'); assert.equal(metadata.apiVersion, 2); assert.equal(metadata.entry, 'activity.json');
  assert.equal(metadata.version, '1.1.0');
  assert.equal(configuration.player, undefined); assert.equal(configuration.kind, 'generic');
  for (const [path, details, title] of [['/', 'Browsing home', 'Home'], ['/home', 'Browsing home', 'Home'],
    ['/discover', 'Browsing charts', 'Charts'], ['/charts', 'Browsing charts', 'Charts'],
    ['/catalog', 'Browsing marketplace', 'Marketplace'], ['/catalog/123/Test-Hat', 'Browsing marketplace', 'Marketplace'],
    ['/upgrades/robux', 'Browsing Robux', 'Robux'], ['/plus', 'Browsing Roblox Plus', 'Roblox Plus'],
    ['/users/profile', 'Browsing profiles', 'Profiles'], ['/users/123/profile', 'Browsing profiles', 'Profiles'],
    ['/users/friends', 'Browsing friends', 'Friends'], ['/my/avatar', 'Browsing avatar', 'Avatar'],
    ['/users/inventory', 'Browsing inventory', 'Inventory'], ['/trades', 'Browsing trades', 'Trades'],
    ['/communities', 'Browsing communities', 'Communities'], ['/my/messages/#!/inbox', 'Browsing messages', 'Messages'],
    ['/my/account#!/privacy', 'Browsing settings', 'Settings'], ['/giftcards-us', 'Browsing gift cards', 'Gift cards'],
    ['/games/4924922222/Brookhaven-RP', 'Viewing: {title}', undefined]]) {
    const route = matchActivityV2Page(configuration, `https://www.roblox.com${path}`);
    assert.equal(route.details, details); assert.equal(route.title, title);
  }
  for (const path of ['/develop', '/create', '/upgrades/paymentmethods', '/users/private/profile', '/catalog/private', '/games/private', '/games/123/title/extra']) {
    assert.equal(matchActivityV2Page(configuration, `https://www.roblox.com${path}`), null);
  }
  assert.equal(configuration.page.routes.find(route => route.id === 'experience').scope, '#game-detail-page');
  assert.equal(configuration.page.routes.find(route => route.id === 'charts').scope, '#game-carousel-web-app');
  assert.deepEqual(configuration.fields.title.selectors, ['h1.game-name']);
  await assert.rejects(fs.access(new URL('activity.js', directory)));
  const icon = await fs.readFile(new URL('icon.png', directory));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), icon.readUInt32BE(20)); assert.ok(icon.length < 262144);
});

test('Roblox browsing title cannot be replaced with unapproved report text', () => {
  const report = { kind: 'generic', routeId: 'home', media: { title: 'Home' },
    playback: { state: 'playing', position: 0, duration: 0, live: false, rate: 1 } };
  validateV2Report(report, configuration, 'https://www.roblox.com/home');
  assert.throws(() => validateV2Report({ ...report, media: { title: 'Private data' } }, configuration, 'https://www.roblox.com/home'));
});
