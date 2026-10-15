// Trusted host adapter. Activity source is evaluated only by the embedded QuickJS VM.
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import wasmBytes from '@jitl/quickjs-wasmfile-release-sync/wasm';

export { collectActivityV2Snapshot, validateActivityV2PageAccess } from './activity-v2-page.js';

export const ACTIVITY_V2_SANDBOX_LIMITS = Object.freeze({
  executionMs: 50,
  memoryBytes: 16 * 1024 * 1024,
  wasmMemoryBytes: 32 * 1024 * 1024,
  stackBytes: 256 * 1024,
  sourceBytes: 512 * 1024,
  requestBytes: 64 * 1024,
  resultBytes: 256 * 1024,
  pendingRequests: 16,
  requestsPerWindow: 30,
  requestWindowMs: 10_000,
  pendingJobs: 256,
});

const limits = ACTIVITY_V2_SANDBOX_LIMITS;
class SandboxFailure extends Error {}
const operations = new Set([
  'presence.report', 'presence.clear', 'settings.get', 'settings.getAll',
  'storage.get', 'storage.set', 'storage.remove', 'storage.clear',
  'net.fetch', 'log.write',
]);
const encoder = new TextEncoder();
let compiledModulePromise;

function getModule() {
  // wasmBinary is bundled as bytes. No URL, network request, or module source from
  // an Activity is ever used to obtain this VM. Disallow any fallback file load.
  compiledModulePromise ||= WebAssembly.compile(wasmBytes);
  // Reuse compiled code, never an instance or allocator. A native VM fault in
  // one Activity must not poison another Activity's WebAssembly runtime.
  return compiledModulePromise.then(wasmModule =>
    newQuickJSWASMModuleFromVariant(newVariant(variant, {
      wasmModule,
      wasmBinary: wasmBytes,
      wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: limits.wasmMemoryBytes / 65536 }),
      locateFile() { throw new Error('External sandbox resources are disabled.'); },
      emscriptenModule: { print() {}, printErr() {} },
    })));
}

function jsonString(value, maximumBytes) {
  const json = JSON.stringify(value === undefined ? null : value);
  if (typeof json !== 'string' || json.length > maximumBytes || encoder.encode(json).byteLength > maximumBytes) {
    throw new SandboxFailure('Activity sandbox JSON exceeds its size limit.');
  }
  return json;
}

// All these functions, collections, and parsers belong to the guest. Only the
// one native callback accepts a JSON string; it returns a guest string handle.
// The bridge and delivery function are captured privately before source runs.
const bootstrap = String.raw`(function (bridge) {
  'use strict';
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const freeze = Object.freeze;
  const keys = Object.keys;
  const define = Object.defineProperty;
  const create = Object.create;
  const hasOwn = Object.hasOwn;
  const P = Promise;
  const promiseThen = Function.prototype.call.bind(P.prototype.then);
  const apply = Reflect.apply;
  const ErrorClass = Error;
  const TypeErrorClass = TypeError;
  const RangeErrorClass = RangeError;
  const pending = create(null);
  const listeners = new Set();
  const add = Function.prototype.call.bind(Set.prototype.add);
  const remove = Function.prototype.call.bind(Set.prototype.delete);
  const values = Function.prototype.call.bind(Set.prototype.values);
  const iteratorNext = Function.prototype.call.bind(Object.getPrototypeOf(new Set().values()).next);
  let listenerCount = 0;
  let sequence = 0;
  let snapshot = freeze({ page: freeze({}), reads: freeze({}), media: freeze([]) });

  function deepFreeze(value, depth = 0) {
    if (value && typeof value === 'object') {
      if (depth > 64) throw new RangeErrorClass('Activity data nesting exceeds its limit.');
      const names = keys(value);
      for (let i = 0; i < names.length; ++i) deepFreeze(value[names[i]], depth + 1);
      freeze(value);
    }
    return value;
  }
  function request(operation, payload) {
    return new P((resolve, reject) => {
      const id = ++sequence;
      if (id > 9007199254740991) { reject(new RangeErrorClass('Activity request sequence exhausted.')); return; }
      let message;
      try { message = stringify({ id, operation, payload }); }
      catch { reject(new TypeErrorClass('Activity requests must contain JSON data.')); return; }
      if (typeof message !== 'string' || message.length > 65536) {
        reject(new RangeErrorClass('Activity request exceeds 64 KB.')); return;
      }
      pending[id] = { resolve, reject };
      const acknowledgement = parse(bridge(message));
      if (acknowledgement.error) {
        delete pending[id];
        reject(new ErrorClass(acknowledgement.error));
      }
    });
  }
  function valueRequest(operation, payload) {
    return promiseThen(request(operation, payload), result => result && result.value);
  }
  function callbackFailed() {
    // A fixed string cannot accidentally disclose host error objects or page data.
    bridge('{"operation":"__callbackError"}');
  }
  function writeLog(level, args) {
    if (args.length > 8) return P.reject(new RangeErrorClass('Activity logs accept at most eight values.'));
    let text;
    try { text = stringify(args); } catch { return P.reject(new TypeErrorClass('Activity logs must contain JSON data.')); }
    if (text.length > 4096) return P.reject(new RangeErrorClass('Activity log exceeds 4 KB.'));
    return request('log.write', { level, args: parse(text) });
  }
  const api = freeze({
    apiVersion: 2,
    onUpdate(callback) {
      if (typeof callback !== 'function') throw new TypeErrorClass('onUpdate requires a function.');
      if (listenerCount >= 32) throw new RangeErrorClass('Activity has too many update listeners.');
      add(listeners, callback);
      listenerCount++;
      return () => { if (remove(listeners, callback)) listenerCount--; };
    },
    page: freeze({
      read(name) { return snapshot.reads && hasOwn(snapshot.reads, name) ? snapshot.reads[name] : undefined; },
      info() { return snapshot.page; },
    }),
    media: freeze({ getAll() { return snapshot.media; } }),
    report(report) { return request('presence.report', { report }); },
    clear() { return request('presence.clear', {}); },
    settings: freeze({
      get(id) { return valueRequest('settings.get', { id }); },
      getAll() { return valueRequest('settings.getAll', {}); },
    }),
    storage: freeze({
      get(key) { return valueRequest('storage.get', { key }); },
      set(key, value) { return valueRequest('storage.set', { key, value }); },
      remove(key) { return valueRequest('storage.remove', { key }); },
      clear() { return valueRequest('storage.clear', {}); },
    }),
    net: freeze({ fetch(url, options = {}) { return request('net.fetch', { url, options }); } }),
    log: freeze({
      debug(...args) { return writeLog('debug', args); },
      info(...args) { return writeLog('info', args); },
      warn(...args) { return writeLog('warn', args); },
      error(...args) { return writeLog('error', args); },
    }),
  });
  define(globalThis, 'ChudPresence', { value: api, enumerable: true, writable: false, configurable: false });
  delete globalThis.__activityV2Bridge;
  return {
    update(json) {
      snapshot = deepFreeze(parse(json));
      // Snapshot listeners once: listeners registered during a callback wait
      // until the next trusted poll and cannot create an unbounded dispatch.
      const callbacks = [];
      const iterator = values(listeners);
      let item;
      while (!(item = iteratorNext(iterator)).done) callbacks[callbacks.length] = item.value;
      for (let i = 0; i < callbacks.length; ++i) {
        try {
          const result = apply(callbacks[i], undefined, [snapshot]);
          const completion = new P(resolve => resolve(result));
          promiseThen(completion, undefined, callbackFailed);
        } catch { callbackFailed(); }
      }
    },
    deliver(json) {
      const message = parse(json);
      const entry = pending[message.id];
      if (!entry) return;
      delete pending[message.id];
      if (message.error) entry.reject(new ErrorClass(message.error));
      else entry.resolve(deepFreeze(message.data));
    },
  };
})(__activityV2Bridge)`;

export async function createActivityV2Sandbox({ source, request, onError = () => {} } = {}) {
  if (typeof source !== 'string' || source.length > limits.sourceBytes || encoder.encode(source).byteLength > limits.sourceBytes) {
    throw new TypeError('Activity sandbox source is missing or exceeds 512 KB.');
  }
  if (typeof request !== 'function') throw new TypeError('Activity sandbox requires a request broker.');
  const module = await getModule();
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  runtime.removeModuleLoader();
  const context = runtime.newContext();
  let disposed = false;
  let deadline = 0;
  let interrupted = false;
  let callbackError = false;
  let updateHandle;
  let deliverHandle;
  const pendingRequests = new Set();
  let requestTimes = [];
  const now = () => performance.now();
  runtime.setInterruptHandler(() => {
    if (now() >= deadline) { interrupted = true; return true; }
    return false;
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    pendingRequests.clear();
    // Quota exhaustion can leave a failed native VM unable to run its normal
    // teardown. Its WASM instance is exclusive to this Activity; release every
    // remaining host reference without masking the original failure/onError.
    for (const cleanup of [
      () => updateHandle?.dispose(), () => deliverHandle?.dispose(),
      () => context.dispose(), () => runtime.dispose(),
    ]) {
      try { cleanup(); } catch { /* The isolated instance is already unusable. */ }
    }
  }

  function notifyError(error) {
    const failure = error instanceof SandboxFailure ? error : new SandboxFailure('Activity sandbox execution failed (native VM fault).');
    dispose();
    try { onError(failure); } catch { /* The owner cannot prevent sandbox cleanup. */ }
    return failure;
  }

  function errorForResult(result) {
    if (!result.error) { result.value.dispose(); return; }
    result.error.dispose();
    throw new SandboxFailure(interrupted
      ? 'Activity sandbox exceeded its execution budget.'
      : 'Activity sandbox execution failed (script error or memory limit).');
  }

  function entry(run) {
    if (disposed) return false;
    deadline = now() + limits.executionMs;
    interrupted = false;
    callbackError = false;
    run();
    let jobCount = 0;
    while (runtime.hasPendingJob()) {
      if (jobCount >= limits.pendingJobs || now() >= deadline) {
        throw new SandboxFailure('Activity sandbox exceeded its pending job or execution budget.');
      }
      const result = runtime.executePendingJobs(1);
      if (result.error) {
        result.error.dispose();
        throw new SandboxFailure('Activity sandbox promise execution failed or exceeded its execution budget.');
      }
      jobCount += result.value;
    }
    if (interrupted) throw new SandboxFailure('Activity sandbox exceeded its execution budget.');
    if (callbackError) throw new SandboxFailure('Activity sandbox update callback failed.');
    return true;
  }

  function call(handle, json) {
    const argument = context.newString(json);
    try { errorForResult(context.callFunction(handle, context.undefined, argument)); }
    finally { argument.dispose(); }
  }

  function deliver(id, data, error) {
    if (disposed || !pendingRequests.delete(id)) return;
    let json;
    try { json = jsonString(error ? { id, error } : { id, data }, limits.resultBytes); }
    catch { json = JSON.stringify({ id, error: 'Activity response exceeds its JSON size limit.' }); }
    try { entry(() => call(deliverHandle, json)); }
    catch (failure) { notifyError(failure); }
  }

  const bridge = context.newFunction('__activityV2Bridge', messageHandle => {
    const reply = value => context.newString(JSON.stringify(value));
    if (disposed || context.typeof(messageHandle) !== 'string') return reply({ error: 'Invalid sandbox request.' });
    const text = context.getString(messageHandle);
    if (text.length > limits.requestBytes || encoder.encode(text).byteLength > limits.requestBytes) {
      return reply({ error: 'Activity request exceeds its JSON size limit.' });
    }
    let message;
    try { message = JSON.parse(text); } catch { return reply({ error: 'Invalid sandbox JSON.' }); }
    if (message?.operation === '__callbackError') { callbackError = true; return reply({ accepted: true }); }
    if (!Number.isSafeInteger(message?.id) || message.id < 1 || !operations.has(message.operation)
      || !message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)
      || pendingRequests.has(message.id)) return reply({ error: 'Unsupported sandbox request.' });
    const time = now();
    requestTimes = requestTimes.filter(previous => time - previous < limits.requestWindowMs);
    if (pendingRequests.size >= limits.pendingRequests || requestTimes.length >= limits.requestsPerWindow) {
      return reply({ error: 'Activity sandbox request limit reached.' });
    }
    const { id, operation, payload } = message;
    pendingRequests.add(id);
    requestTimes.push(time);
    // Schedule after the native callback returns: no host async function or
    // Promise enters the guest and disposing never frees an active C stack.
    Promise.resolve().then(() => {
      if (disposed || !pendingRequests.has(id)) return;
      return request(operation, payload);
    }).then(
      data => deliver(id, data),
      () => deliver(id, undefined, 'Activity request was rejected by the broker.'),
    );
    return reply({ accepted: true });
  });
  context.setProp(context.global, '__activityV2Bridge', bridge);
  bridge.dispose();
  try {
    entry(() => {
      const result = context.evalCode(bootstrap, 'activity-v2-bootstrap.js');
      if (result.error) { errorForResult(result); return; }
      updateHandle = context.getProp(result.value, 'update');
      deliverHandle = context.getProp(result.value, 'deliver');
      result.value.dispose();
      errorForResult(context.evalCode(source, 'activity-v2.js', { type: 'global', strict: true }));
    });
  } catch (error) {
    throw notifyError(error);
  }

  return Object.freeze({
    update(snapshot) {
      if (disposed) return false;
      try {
        const json = jsonString(snapshot, limits.resultBytes);
        return entry(() => call(updateHandle, json));
      } catch (error) { notifyError(error); return false; }
    },
    dispose,
  });
}
