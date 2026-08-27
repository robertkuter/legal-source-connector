import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const packetPath = path.join(
  here,
  '..',
  'evals',
  'abl-primer-parity',
  'source-packet-set.json',
);

const packetSet = JSON.parse(await readFile(packetPath, 'utf8'));
const expectedIds = ['P01', 'P02', 'P03', 'P04', 'P07', 'P08', 'P09', 'P11', 'P12', 'P13'];
const forbiddenLocators = ['7 kap. 40 §', '13 kap. 35 §', '25 kap. 18 §'];

const normalize = (value) => value.replace(/\r\n?/g, '\n').trim();
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

assert.equal(packetSet.packet_set_version, '0.1.0');
assert.equal(packetSet.mode, 'packet-only');
assert.equal(packetSet.retrieval_mode, 'cached_snapshot');
assert.equal(packetSet.live_currentness_checked, false);
assert.equal(packetSet.authority.authority_id, 'sfs-2005-551');
assert.equal(packetSet.authority.index_version, '0.6');
assert.equal(packetSet.authority.capability_status, 'supported');
assert.equal(packetSet.authority.temporal_capability.status, 'layered_unresolved');
assert.equal(packetSet.authority.attribution.text, 'Källa: Sveriges riksdag');
assert.equal(packetSet.packets.length, expectedIds.length);
assert.deepEqual(packetSet.packets.map((packet) => packet.packet_id), expectedIds);

for (const packet of packetSet.packets) {
  assert.equal(packet.status, 'found', `${packet.packet_id} must be found`);
  assert.equal(packet.requested_locator, packet.canonical_locator, `${packet.packet_id} drifted`);
  assert.equal(packetSet.authority.authority_id, 'sfs-2005-551');
  assert.equal(packet.packet_text, normalize(packet.packet_text), `${packet.packet_id} is not normalized`);
  assert.equal(sha256(normalize(packet.packet_text)), packet.section_sha256, `${packet.packet_id} hash mismatch`);
  assert.ok(packet.source_offsets.start < packet.source_offsets.end_exclusive, `${packet.packet_id} offsets invalid`);
  assert.equal(packet.offset_unit, 'UTF-16 code units in document.text');
  assert.equal(packet.temporal.resolution, 'unmarked_locator');
  assert.ok(!('plain_english' in packet), `${packet.packet_id} leaked presentation prose`);
  assert.ok(!('applicability' in packet), `${packet.packet_id} leaked legal analysis`);
  for (const forbidden of forbiddenLocators) {
    assert.notEqual(packet.canonical_locator, forbidden, `${packet.packet_id} includes an excluded locator`);
  }
}

const serialized = JSON.stringify(packetSet);
assert.ok(!serialized.includes('cap table'), 'packet set should not contain primer prose');
assert.ok(!serialized.includes('What still needs checking'), 'packet set should not contain primer prose');

console.log(JSON.stringify({
  test_suite: 'abl-primer-parity-packet-v0.1',
  total: 1 + packetSet.packets.length,
  passed: 1 + packetSet.packets.length,
  failed: 0,
  packet_count: packetSet.packets.length,
  checked: ['metadata', 'packet_ids', 'section_hashes', 'offsets', 'evidence_only_shape'],
}, null, 2));
