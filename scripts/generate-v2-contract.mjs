import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v1 = JSON.parse(await fs.readFile(path.join(root, 'schemas/activity-api-v1.json'), 'utf8'));
const metadataSchema = structuredClone(v1.metadataSchema);
metadataSchema.$id = 'https://chudpresence.local/schemas/activity-v2.schema.json';
metadataSchema.title = 'ChudPresence sandboxed Activity API v2 metadata';
metadataSchema.properties.apiVersion = { const: 2 };
metadataSchema.properties.presence.properties.navigationGraceMs = {
  type: 'integer', minimum: 0, maximum: 5000, default: 0,
  description: 'Bounded presence retention during navigation within this Activity. Tab close and explicit teardown bypass it.',
};
metadataSchema.properties.pageAccess = {
  type: 'object', additionalProperties: false,
  properties: {
    url: { type: 'boolean', default: false },
    media: { type: 'boolean', default: false },
    queryParameters: { type: 'array', maxItems: 16, uniqueItems: true, items: {
      type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z_][A-Za-z0-9_-]{0,63}$',
      description: 'Explicit public query keys only. Credential/OAuth keys are rejected by runtime validation.' },
    },
    selectors: {
      type: 'object', maxProperties: 32,
      propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$', not: { enum: ['constructor', 'prototype'] } },
      additionalProperties: {
        type: 'object', additionalProperties: false, required: ['selector', 'read'],
        properties: {
          selector: { type: 'string', minLength: 1, maxLength: 1024,
            description: 'Validated public CSS grammar. No escapes, secret attribute predicates, or stateful pseudos. >>> crosses an open shadow root.' },
          read: { enum: ['text', 'attribute', 'json'] },
          all: { type: 'boolean', default: false },
          attribute: { enum: ['title', 'alt', 'aria-label', 'href', 'src', 'poster', 'content', 'datetime'] },
          path: { type: 'array', minItems: 1, maxItems: 12, items: {
            type: 'string', maxLength: 100, pattern: '^(?:[A-Za-z_][A-Za-z0-9_-]*|[0-9]+)$',
            description: 'Own-property keys only. Credential and prototype keys are rejected by the runtime.' },
          },
        },
        allOf: [
          { if: { properties: { read: { const: 'attribute' } } }, then: { required: ['attribute'] },
            else: { not: { required: ['attribute'] } } },
          { if: { properties: { read: { const: 'json' } } }, then: { required: ['path'] },
            else: { not: { required: ['path'] } } },
        ],
      },
    },
  },
};
metadataSchema.properties.pageAccess.properties.mediaScopes = {
  type: 'object', maxProperties: 4,
  propertyNames: structuredClone(metadataSchema.properties.pageAccess.properties.selectors.propertyNames),
  description: 'Bounded single-player ancestor containers. Requires media: true; all captures share the page read limits.',
  additionalProperties: {
    type: 'object', additionalProperties: false, required: ['container', 'ancestors', 'selectors'],
    properties: {
      container: { type: 'string', minLength: 1, maxLength: 1024 },
      ancestors: { type: 'integer', minimum: 1, maximum: 16 },
      exclude: { type: 'string', minLength: 1, maxLength: 1024 },
      selectors: structuredClone(metadataSchema.properties.pageAccess.properties.selectors),
    },
  },
};
metadataSchema.properties.pageAccess.allOf = [{
  if: { required: ['mediaScopes'] }, then: { required: ['media'], properties: { media: { const: true } } },
}];
metadataSchema.properties.pageAccess.properties.mediaScopes.additionalProperties.properties.selectors.additionalProperties.properties.read.enum = ['text', 'attribute'];
const reportSchema = structuredClone(v1.reportSchema);
reportSchema.$id = 'https://chudpresence.local/schemas/activity-v2-report.schema.json';
reportSchema.title = 'ChudPresence Activity API v2 Report';
reportSchema.properties.display.properties.name = { type: 'string', minLength: 1, maxLength: 256, pattern: '\\S' };
reportSchema.properties.playback.properties.elapsed = { type: 'boolean', description: 'Elapsed time for a generic page activity, without a Live label.' };
reportSchema.allOf = [{
  if: { required: ['playback'], properties: { playback: { required: ['elapsed'], properties: { elapsed: { const: true } } } } },
  then: { properties: { kind: { const: 'generic' }, playback: { properties: { live: { const: false }, duration: { const: 0 } } } } },
}];
const contract = {
  schemaVersion: 1, apiVersion: 2, supportedApiVersions: [1, 2],
  execution: 'QuickJS in WebAssembly; package source is data, never native browser JavaScript',
  limits: { ...v1.limits, executionMs: 50, memoryBytes: 16777216, wasmMemoryBytes: 33554432, stackBytes: 262144,
    requestBytes: 65536, resultBytes: 262144, pendingRequests: 16, requestsPerWindow: 30,
    requestWindowMs: 10000, pendingJobs: 256, updateIntervalMs: 2000,
    workerStartupMs: 5000, workerExecutionMs: 2000, workerInactivityMs: 120000, workerSessions: 16 },
  metadataSchema, reportSchema,
};
for (const [name, value] of Object.entries({ 'activity-api-v2.json': contract, 'activity-v2.schema.json': metadataSchema, 'activity-v2-report.schema.json': reportSchema })) {
  const destination = path.join(root, 'schemas', name);
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes('--check')) assert.equal(await fs.readFile(destination, 'utf8'), output, `${name} is stale.`);
  else await fs.writeFile(destination, output);
}
console.log('Activity v2 metadata and report contracts are current.');
