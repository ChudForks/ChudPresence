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
const contract = {
  schemaVersion: 1, apiVersion: 2, supportedApiVersions: [1, 2],
  execution: 'QuickJS in WebAssembly; package source is data, never native browser JavaScript',
  limits: { ...v1.limits, executionMs: 50, memoryBytes: 16777216, wasmMemoryBytes: 33554432, stackBytes: 262144,
    requestBytes: 65536, resultBytes: 262144, pendingRequests: 16, requestsPerWindow: 30,
    requestWindowMs: 10000, pendingJobs: 256, updateIntervalMs: 2000,
    workerStartupMs: 5000, workerExecutionMs: 2000, workerInactivityMs: 120000, workerSessions: 16 },
  metadataSchema, reportSchema: v1.reportSchema,
};
for (const [name, value] of Object.entries({ 'activity-api-v2.json': contract, 'activity-v2.schema.json': metadataSchema })) {
  const destination = path.join(root, 'schemas', name);
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes('--check')) assert.equal(await fs.readFile(destination, 'utf8'), output, `${name} is stale.`);
  else await fs.writeFile(destination, output);
}
console.log('Activity v2 metadata and report contracts are current.');
