import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVITY_ID_PATTERN,
  MAX_ACTIVITY_ICON_BYTES,
  MAX_ACTIVITY_METADATA_BYTES,
  validateActivityV2,
  validateV2Metadata,
} from '../schemas/activity-api-v2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const activityRoot = path.join(root, 'activities');
const catalogPath = path.join(root, 'catalog.json');
const idPattern = new RegExp(ACTIVITY_ID_PATTERN);
const packageFields = new Set(['metadata.json', 'activity.json', 'icon.png', 'README.md', 'tests']);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
// Match the bytes served by Git even in older Windows CRLF checkouts.
const repositoryText = (value) => value.replace(/\r\n/g, '\n');

export function validateMetadata(metadata, directoryName, metadataText = JSON.stringify(metadata)) {
  validateV2Metadata(metadata);
  if (metadata.id !== directoryName || !idPattern.test(directoryName)) {
    throw new Error(`${directoryName}: metadata ID must match its activity directory.`);
  }
  if (Buffer.byteLength(metadataText, 'utf8') > MAX_ACTIVITY_METADATA_BYTES) {
    throw new Error(`${directoryName}: metadata.json exceeds 64 KB.`);
  }
}

export async function readPackage(directoryName) {
  if (!idPattern.test(directoryName)) throw new Error(`Invalid Activity directory name: ${directoryName}`);
  const directory = path.join(activityRoot, directoryName);
  const children = await fs.readdir(directory, { withFileTypes: true });
  for (const child of children) {
    if (child.name === 'activity.js') throw new Error(`${directoryName}: V2 packages cannot contain activity.js.`);
    if (!packageFields.has(child.name) || child.isSymbolicLink() ||
        (child.name === 'tests' ? !child.isDirectory() : !child.isFile())) {
      throw new Error(`${directoryName}: unsupported package file ${child.name}; V2 packages contain JSON, an optional PNG, README.md, and tests/.`);
    }
  }
  const metadataText = repositoryText(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));
  const metadata = JSON.parse(metadataText);
  validateMetadata(metadata, directoryName, metadataText);
  const source = repositoryText(await fs.readFile(path.join(directory, 'activity.json'), 'utf8'));
  validateActivityV2(source);
  const entry = {
    ...Object.fromEntries(Object.entries(metadata).filter(([field]) => !['entry', 'icon'].includes(field))),
    entry: `activities/${directoryName}/activity.json`,
    metadata: `activities/${directoryName}/metadata.json`,
    sha256: digest(source),
    metadataSha256: digest(metadataText),
  };
  if (metadata.icon === 'icon.png') {
    const icon = await fs.readFile(path.join(directory, 'icon.png'));
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (icon.length > MAX_ACTIVITY_ICON_BYTES || !icon.subarray(0, 8).equals(signature)) {
      throw new Error(`${directoryName}: icon.png must be a PNG up to ${MAX_ACTIVITY_ICON_BYTES / 1024} KB.`);
    }
    entry.icon = `activities/${directoryName}/icon.png`;
    entry.iconSha256 = digest(icon);
  }
  return entry;
}

export async function buildCatalog({ check = false } = {}) {
  const directories = (await fs.readdir(activityRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const activities = await Promise.all(directories.map(readPackage));
  const generated = { schemaVersion: 1, generatedAt: new Date().toISOString(), activities };
  if (check) {
    const current = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    if (current.schemaVersion !== generated.schemaVersion ||
        JSON.stringify(current.activities) !== JSON.stringify(activities)) {
      throw new Error('catalog.json is stale. Run npm run build:catalog and commit the result.');
    }
    console.log(`Validated ${activities.length} V2 Activities and catalog hashes.`);
  } else {
    await fs.writeFile(catalogPath, `${JSON.stringify(generated, null, 2)}\n`);
    console.log(`Wrote catalog.json with ${activities.length} V2 Activities.`);
  }
  return generated;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildCatalog({ check: process.argv.includes('--check') });
}
