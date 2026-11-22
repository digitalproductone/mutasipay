import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLockedQrisChannel,
  createDefaultDanaChannel,
  detectProviderNameFromPackage,
  maskQrisPayload,
  resolveActiveChannel,
} from './qrisChannels';
import { calculateCrc16Ccitt, DEFAULT_DANA_STATIC_QRIS } from './qris';

function makeValidSampleNeobankQris(): string {
  const withoutCrc =
    '00020101021126590013ID.CO.BNC.WWW011893600490001234567802090012345670303UMI51440014ID.CO.QRIS.WWW0215ID10269988776650303UMI5204581253033605802ID5913TOKO NEO MAJU6012Kota Bandung6105401116304';
  return `${withoutCrc}${calculateCrc16Ccitt(withoutCrc)}`;
}

test('creates default locked DANA Bisnis channel from AYAM PETOK-PETOK static QRIS', () => {
  const dana = createDefaultDanaChannel();
  assert.equal(dana.id, 'qris_dana_default');
  assert.equal(dana.provider, 'DANA_BISNIS');
  assert.equal(dana.packageName, 'id.dana.merchant');
  assert.equal(dana.merchantName, 'AYAM PETOK-PETOK');
  assert.equal(dana.crc16, '7F79');
  assert.equal(dana.locked, true);
});

test('adds a Neobank QRIS channel, locks it permanently, and rejects duplicates or bad CRC', () => {
  const dana = createDefaultDanaChannel();
  const neoQris = makeValidSampleNeobankQris();

  const neo = buildLockedQrisChannel({
    id: 'qris_neo_1',
    label: 'Neobank Bisnis',
    provider: 'NEOBANK',
    staticQris: neoQris,
    existingChannels: [dana],
  });

  assert.equal(neo.provider, 'NEOBANK');
  assert.equal(neo.providerName, 'Neobank (BNC)');
  assert.equal(neo.packageName, 'com.bnc.finance');
  assert.equal(neo.merchantName, 'TOKO NEO MAJU');
  assert.equal(neo.locked, true);

  // Reject duplicate QRIS
  assert.throws(
    () =>
      buildLockedQrisChannel({
        id: 'qris_dup',
        label: 'Duplikat',
        provider: 'DANA_BISNIS',
        staticQris: DEFAULT_DANA_STATIC_QRIS,
        existingChannels: [dana, neo],
      }),
    /sudah terdaftar/i
  );

  // Reject invalid CRC
  assert.throws(
    () =>
      buildLockedQrisChannel({
        id: 'qris_bad',
        label: 'Rusak',
        provider: 'NEOBANK',
        staticQris: `${neoQris.slice(0, -4)}0000`,
        existingChannels: [dana],
      }),
    /tidak valid/i
  );
});

test('resolves requested channel, falls back to active channel, and identifies package names', () => {
  const dana = createDefaultDanaChannel();
  const neo = buildLockedQrisChannel({
    id: 'qris_neo_1',
    label: 'Neobank Bisnis',
    provider: 'NEOBANK',
    staticQris: makeValidSampleNeobankQris(),
    existingChannels: [dana],
  });

  const resolvedRequested = resolveActiveChannel([dana, neo], 'qris_neo_1', 'qris_dana_default');
  assert.equal(resolvedRequested.id, 'qris_neo_1');

  const resolvedActive = resolveActiveChannel([dana, neo], undefined, 'qris_neo_1');
  assert.equal(resolvedActive.id, 'qris_neo_1');

  assert.equal(detectProviderNameFromPackage('com.bnc.finance'), 'Neobank (BNC)');
  assert.equal(detectProviderNameFromPackage('id.dana.merchant'), 'DANA Bisnis');
  assert.ok(maskQrisPayload(DEFAULT_DANA_STATIC_QRIS).includes('••••'));
});
