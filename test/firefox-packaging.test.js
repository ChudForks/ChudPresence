import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import { buildPackages, createZip, crc32 } from '../scripts/build.mjs';

test('browser package ZIP checksums match the standard CRC32 reference vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('unsigned Firefox XPI bytes are deterministic and contain a root manifest readable through the ZIP central directory', () => {
  const manifest = Buffer.from('{"manifest_version":3,"name":"Firefox fixture","version":"1.0"}');
  const files = [{ name: 'manifest.json', bytes: manifest },
    { name: 'assets/日本語.txt', bytes: Buffer.from('UTF-8 extension asset') }];
  const archive = createZip(files);
  assert.deepEqual(createZip(files), archive);
  const end = archive.length - 22;
  assert.equal(archive.readUInt32LE(end), 0x06054b50);
  assert.equal(archive.readUInt16LE(end + 10), 2);
  let cursor = archive.readUInt32LE(end + 16);
  const read = new Map();
  for (let index = 0; index < files.length; index += 1) {
    assert.equal(archive.readUInt32LE(cursor), 0x02014b50);
    assert.equal(archive.readUInt16LE(cursor + 8) & 0x0800, 0x0800);
    assert.equal(archive.readUInt16LE(cursor + 10), 8);
    const compressedLength = archive.readUInt32LE(cursor + 20);
    const expectedLength = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const name = archive.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const local = archive.readUInt32LE(cursor + 42);
    assert.equal(archive.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const bytes = inflateRawSync(archive.subarray(start, start + compressedLength));
    assert.equal(bytes.length, expectedLength);
    assert.equal(crc32(bytes), archive.readUInt32LE(cursor + 16));
    read.set(name, bytes);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(cursor, end);
  assert.deepEqual(read.get('manifest.json'), manifest);
  assert.equal(read.get('assets/日本語.txt').toString(), 'UTF-8 extension asset');
});

test('browser packaging rejects unsafe archive paths and unknown build targets before modifying outputs', async () => {
  for (const name of ['../outside', '/absolute', 'nested/../../outside', 'windows\\path']) {
    assert.throws(() => createZip([{ name, bytes: Buffer.from('unsafe') }]), /Unsafe archive path/);
  }
  await assert.rejects(buildPackages('unknown'), /Build target must be chromium, firefox, or all/);
});
