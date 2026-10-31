import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(await fs.readFile(path.join(root, 'schemas/activity-api-v1.json'), 'utf8'));
assert.equal(contract.schemaVersion, 1, 'Unsupported canonical Activity API contract');
const metadata = contract.metadataSchema;
const report = contract.reportSchema;
const values = {
  ACTIVITY_API_VERSION: contract.apiVersion,
  SUPPORTED_ACTIVITY_API_VERSIONS: contract.supportedApiVersions,
  MAX_ACTIVITY_METADATA_BYTES: contract.limits.metadataBytes,
  MAX_ACTIVITY_REPORT_BYTES: contract.limits.reportBytes,
  MAX_ACTIVITY_SOURCE_BYTES: contract.limits.sourceBytes,
  MAX_ACTIVITY_ICON_BYTES: contract.limits.iconBytes,
  MAX_ACTIVITY_TEXT_LENGTH: report.$defs.text.maxLength,
  MAX_ACTIVITY_URL_LENGTH: report.$defs.httpsUrl.maxLength,
  ACTIVITY_ID_PATTERN: metadata.properties.id.pattern,
  ACTIVITY_SEMVER_PATTERN: metadata.properties.version.pattern,
  ACTIVITY_METADATA_FIELDS: Object.keys(metadata.properties),
  ACTIVITY_KIND_VALUES: report.properties.kind.enum,
  PRESENCE_KIND_VALUES: metadata.properties.presence.properties.kind.enum,
  REPORT_MEDIA_FIELDS: Object.keys(report.properties.media.properties),
  REPORT_PLAYBACK_FIELDS: Object.keys(report.properties.playback.properties),
  REPORT_DISPLAY_FIELDS: Object.keys(report.properties.display.properties),
  REPORT_ARTWORK_FIELDS: Object.keys(report.properties.artwork.properties),
  REPORT_VISIBILITY_VALUES: report.properties.visibility.enum,
  REPORT_FOCUS_POLICY_VALUES: report.properties.focusPolicy.enum,
  REPORT_PLAYBACK_STATE_VALUES: report.properties.playback.properties.state.enum,
  REPORT_STATUS_DISPLAY_VALUES: report.properties.display.properties.statusDisplay.enum,
};
const runtime = Object.entries(values).map(([name, value]) => {
  assert.notEqual(value, undefined, `Missing canonical value: ${name}`);
  const literal = JSON.stringify(value);
  return `export const ${name} = ${Array.isArray(value) ? `Object.freeze(${literal})` : literal};`;
}).join('\n') + '\n';
const outputs = new Map([
  ['extension/core/activity-contract.generated.js', runtime],
  ['schemas/activity.schema.json', `${JSON.stringify(metadata, null, 2)}\n`],
  ['schemas/activity-report.schema.json', `${JSON.stringify(report, null, 2)}\n`],
]);
for (const [filename, output] of outputs) {
  const destination = path.join(root, filename);
  if (process.argv.includes('--check')) {
    assert.equal(await fs.readFile(destination, 'utf8'), output, `${filename} is stale. Run npm run build:contracts.`);
  } else {
    await fs.writeFile(destination, output);
  }
}
console.log('Activity v1 runtime contract and schemas match the canonical source.');
