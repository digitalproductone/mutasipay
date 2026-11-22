import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DANA_STATIC_QRIS,
  calculateCrc16Ccitt,
  formatRupiah,
  generateDynamicQris,
  parseQrisMetadata,
} from './qris';

test('parses the provided DANA Bisnis static QRIS accurately and validates CRC 7F79', () => {
  const meta = parseQrisMetadata(DEFAULT_DANA_STATIC_QRIS);

  assert.equal(meta.valid, true);
  assert.equal(meta.crcProvided, '7F79');
  assert.equal(meta.crcExpected, '7F79');
  assert.equal(meta.isDynamic, false);
  assert.equal(meta.merchantName, 'AYAM PETOK-PETOK');
  assert.equal(meta.merchantCity, 'Kabupaten Bandu');
  assert.equal(meta.postalCode, '40559');
  assert.equal(meta.acquirerDomain, 'ID.DANA.WWW');
  assert.equal(meta.nmid, 'ID1025451598425');
  assert.equal(meta.merchantPan, '936009153005333212');
  assert.equal(meta.merchantId, '005333212');
  assert.equal(meta.merchantCriteria, 'UMI');
  assert.equal(meta.currencyCode, '360');
  assert.equal(meta.amount, null);
});

test('converts static DANA Bisnis QRIS to dynamic QRIS with exact nominal and valid CRC-16', () => {
  const dynamic = generateDynamicQris(DEFAULT_DANA_STATIC_QRIS, 99247);
  const meta = parseQrisMetadata(dynamic);

  assert.equal(meta.valid, true);
  assert.equal(meta.isDynamic, true);
  assert.equal(meta.pointOfInitiation, '12');
  assert.equal(meta.amount, 99247);
  assert.equal(meta.merchantName, 'AYAM PETOK-PETOK');
  assert.equal(meta.nmid, 'ID1025451598425');
  assert.ok(dynamic.includes('540599247'), 'Dynamic QRIS must include Tag 54 length 05 value 99247');
  assert.equal(dynamic.slice(-4), calculateCrc16Ccitt(dynamic.slice(0, -4)));
});

test('detects corrupted QRIS checksum as invalid', () => {
  const tampered = `${DEFAULT_DANA_STATIC_QRIS.slice(0, -4)}0000`;
  const meta = parseQrisMetadata(tampered);
  assert.equal(meta.valid, false);
});

test('rejects zero or negative nominal when generating dynamic QRIS', () => {
  assert.throws(() => generateDynamicQris(DEFAULT_DANA_STATIC_QRIS, 0));
  assert.throws(() => generateDynamicQris(DEFAULT_DANA_STATIC_QRIS, -5000));
});

test('formats Indonesian Rupiah consistently', () => {
  assert.equal(formatRupiah(99247), 'Rp 99.247');
  assert.equal(formatRupiah(1500000), 'Rp 1.500.000');
});
