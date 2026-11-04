import {test, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {withCollectionTransaction} from '../src/collectionStorage.js';

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const indexedDBDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
}
afterEach(() => {
  for (const [name, descriptor] of [['navigator', navigatorDescriptor], ['indexedDB', indexedDBDescriptor]]) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test('uses the named Web Lock before updating when IndexedDB is missing', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  setGlobal('indexedDB', undefined);
  setGlobal('navigator', {locks: {request(key, callback) {
    assert.equal(key, 'andee-memory');
    return gate.then(callback);
  }}});
  const saved = withCollectionTransaction('andee-memory', () => { calls++; return 'saved'; });
  await Promise.resolve();
  assert.equal(calls, 0);
  release();
  assert.equal(await saved, 'saved');
  assert.equal(calls, 1);
});

test('rejects instead of writing when both IndexedDB and Web Locks are missing', async () => {
  let calls = 0;
  setGlobal('indexedDB', undefined);
  setGlobal('navigator', {});
  await assert.rejects(withCollectionTransaction('andee-scenes', () => { calls++; }));
  assert.equal(calls, 0);
});

test('does not fall back when IndexedDB exists but open fails', async () => {
  const failure = new Error('IndexedDB blocked');
  let calls = 0;
  setGlobal('indexedDB', {open() { throw failure; }});
  setGlobal('navigator', {locks: {request(key, callback) { return Promise.resolve().then(callback); }}});
  await assert.rejects(withCollectionTransaction('andee-scenes', () => { calls++; }), failure);
  assert.equal(calls, 0);
});

test('propagates a failed update while using the Web Lock fallback', async () => {
  const failure = new Error('storage quota exceeded');
  setGlobal('indexedDB', undefined);
  setGlobal('navigator', {locks: {request(key, callback) { return Promise.resolve().then(callback); }}});
  await assert.rejects(withCollectionTransaction('andee-scenes', () => { throw failure; }), failure);
});

test('does not fall back on an asynchronous IndexedDB open error', async () => {
  const failure = new Error('IndexedDB open failed');
  let calls = 0;
  setGlobal('indexedDB', {open() {
    const request = {error: failure};
    queueMicrotask(() => request.onerror());
    return request;
  }});
  setGlobal('navigator', {locks: {request(key, callback) { return Promise.resolve().then(callback); }}});
  await assert.rejects(withCollectionTransaction('andee-scenes', () => { calls++; }), failure);
  assert.equal(calls, 0);
});
