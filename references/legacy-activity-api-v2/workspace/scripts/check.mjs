import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension');

async function javascriptFiles(directory) {
  const found = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await javascriptFiles(target));
    if (entry.isFile() && entry.name.endsWith('.js')) found.push(target);
  }
  return found;
}

JSON.parse(await fs.readFile(path.join(extension, 'manifest.json'), 'utf8'));
for (const file of await javascriptFiles(extension)) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
const activities = path.join(root, 'ChudPresence-Activities');
const activitiesV2 = path.join(root, 'ChudPresence-Activities-V2');
const bundledYouTube = path.join(extension, 'default-activities', 'youtube');
for (const filename of ['metadata.json', 'activity.js', 'icon.png']) {
  const bundled = await fs.readFile(path.join(bundledYouTube, filename));
  assert.ok(bundled.length > 0, `bundled YouTube ${filename} is empty`);
  try {
    const catalogCopy = await fs.readFile(path.join(activities, 'activities', 'youtube', filename));
    assert.deepEqual(bundled, catalogCopy, `bundled YouTube ${filename} differs from the Activity catalog`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const schemaRoot = path.join(root, 'schemas');
const apiContract = JSON.parse(await fs.readFile(path.join(schemaRoot, 'activity-api-v1.json'), 'utf8'));
const generatedMetadataSchema = JSON.parse(await fs.readFile(path.join(schemaRoot, 'activity.schema.json'), 'utf8'));
const generatedReportSchema = JSON.parse(await fs.readFile(path.join(schemaRoot, 'activity-report.schema.json'), 'utf8'));
assert.deepEqual(generatedMetadataSchema, apiContract.metadataSchema, 'metadata schema output is stale');
assert.deepEqual(generatedReportSchema, apiContract.reportSchema, 'report schema output is stale');
const runtimeContract = await import(pathToFileURL(path.join(extension, 'core', 'activity-contract.generated.js')));
const v2Contract = JSON.parse(await fs.readFile(path.join(schemaRoot, 'activity-api-v2.json'), 'utf8'));
assert.equal(v2Contract.apiVersion, 2);
assert.deepEqual(JSON.parse(await fs.readFile(path.join(schemaRoot, 'activity-v2-metadata.schema.json'), 'utf8')), v2Contract.metadataSchema);
assert.deepEqual(JSON.parse(await fs.readFile(path.join(schemaRoot, 'activity-v2.schema.json'), 'utf8')), v2Contract.activitySchema);
const validator = await import(pathToFileURL(path.join(extension, 'core', 'activity-validator.js')));
const v2 = await import(pathToFileURL(path.join(extension, 'core', 'activity-api-v2.js')));
assert.deepEqual(validator.SUPPORTED_ACTIVITY_API_VERSIONS, v2Contract.supportedApiVersions);
assert.deepEqual(v2.V2_METADATA_FIELDS, Object.keys(v2Contract.metadataSchema.properties));
assert.deepEqual(v2.V2_TEXT_FIELDS, Object.keys((v2Contract.activitySchema.oneOf?.[0] || v2Contract.activitySchema).properties.fields.properties));
const exampleMetadata = validator.validateActivityMetadata(JSON.parse(await fs.readFile(path.join(root, 'examples/v2/html-media/metadata.json'), 'utf8')));
validator.validateActivityPackageSource(await fs.readFile(path.join(root, 'examples/v2/html-media/activity.json'), 'utf8'), exampleMetadata);
const report = apiContract.reportSchema;
const metadata = apiContract.metadataSchema;
assert.equal(runtimeContract.ACTIVITY_API_VERSION, apiContract.apiVersion);
assert.deepEqual(runtimeContract.SUPPORTED_ACTIVITY_API_VERSIONS, apiContract.supportedApiVersions);
assert.deepEqual(runtimeContract.ACTIVITY_METADATA_FIELDS, Object.keys(metadata.properties));
assert.deepEqual(runtimeContract.ACTIVITY_KIND_VALUES, report.properties.kind.enum);
assert.deepEqual(runtimeContract.PRESENCE_KIND_VALUES, metadata.properties.presence.properties.kind.enum);
assert.deepEqual(runtimeContract.REPORT_MEDIA_FIELDS, Object.keys(report.properties.media.properties));
assert.deepEqual(runtimeContract.REPORT_PLAYBACK_FIELDS, Object.keys(report.properties.playback.properties));
assert.deepEqual(runtimeContract.REPORT_DISPLAY_FIELDS, Object.keys(report.properties.display.properties));
assert.deepEqual(runtimeContract.REPORT_ARTWORK_FIELDS, Object.keys(report.properties.artwork.properties));
assert.deepEqual(runtimeContract.REPORT_VISIBILITY_VALUES, report.properties.visibility.enum);
assert.deepEqual(runtimeContract.REPORT_PLAYBACK_STATE_VALUES, report.properties.playback.properties.state.enum);
assert.deepEqual(runtimeContract.REPORT_STATUS_DISPLAY_VALUES, report.properties.display.properties.statusDisplay.enum);
assert.equal(runtimeContract.MAX_ACTIVITY_METADATA_BYTES, apiContract.limits.metadataBytes);
assert.equal(runtimeContract.MAX_ACTIVITY_REPORT_BYTES, apiContract.limits.reportBytes);
assert.equal(runtimeContract.MAX_ACTIVITY_SOURCE_BYTES, apiContract.limits.sourceBytes);
assert.equal(runtimeContract.MAX_ACTIVITY_ICON_BYTES, apiContract.limits.iconBytes);

let activitiesContractAvailable = true;
try {
  await fs.access(path.join(activities, 'tools', 'generate-api-contract.mjs'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  activitiesContractAvailable = false;
}
if (activitiesContractAvailable) {
  execFileSync(process.execPath, ['tools/generate-api-contract.mjs', '--check'], { cwd: activities, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/build-catalog.mjs', '--check'], { cwd: activities, stdio: 'inherit' });
  const [repositoryCanonical, repositoryContract, extensionContract] = await Promise.all([
    fs.readFile(path.join(activities, 'schemas', 'activity-api-v1.json'), 'utf8'),
    fs.readFile(path.join(activities, 'schemas', 'activity-contract.generated.js'), 'utf8'),
    fs.readFile(path.join(extension, 'core', 'activity-contract.generated.js'), 'utf8'),
  ]);
  assert.deepEqual(JSON.parse(repositoryCanonical), apiContract, 'extension and Activities canonical contract copies differ');
  if (repositoryContract !== extensionContract) {
    throw new Error('The extension runtime contract is out of sync with the Activities canonical contract.');
  }
}
let activitiesV2Available = true;
try {
  await fs.access(path.join(activitiesV2, 'tools', 'generate-api-v2.mjs'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  activitiesV2Available = false;
}
if (activitiesV2Available) {
  execFileSync(process.execPath, ['tools/generate-api-v2.mjs', '--check'], { cwd: activitiesV2, stdio: 'inherit' });
  execFileSync(process.execPath, ['tools/build-catalog.mjs', '--check'], { cwd: activitiesV2, stdio: 'inherit' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(activitiesV2, 'schemas', 'activity-api-v2.json'), 'utf8')),
    v2Contract, 'extension and V2 Activities canonical contract copies differ');
  assert.equal(await fs.readFile(path.join(activitiesV2, 'schemas', 'activity-api-v2.js'), 'utf8'),
    await fs.readFile(path.join(extension, 'core', 'activity-api-v2.js'), 'utf8'),
    'extension and V2 Activities validators differ');
}
console.log('Manifest, extension JavaScript, V1/V2 contracts, V2 example, and catalog hashes are valid.');
