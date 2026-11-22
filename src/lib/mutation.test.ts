import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDanaNotification, parseIndonesianAmount } from './mutationParser';
import {
  generateUniqueCode,
  matchMutationToOrder,
  normalizeWhatsappNumber,
  renderFulfillmentTemplate,
} from './matcher';
import type { OrderRecord } from '../types';

test('parses multiple Indonesian Rupiah string formats', () => {
  assert.equal(parseIndonesianAmount('99.247'), 99247);
  assert.equal(parseIndonesianAmount('99,247'), 99247);
  assert.equal(parseIndonesianAmount('149.312,00'), 149312);
  assert.equal(parseIndonesianAmount('250000'), 250000);
  assert.equal(parseIndonesianAmount('abc'), null);
});

test('extracts amount and sender from real DANA Bisnis and Neobank QRIS notifications', () => {
  const res1 = parseDanaNotification({
    title: 'DANA Bisnis',
    message: 'Kamu baru saja menerima pembayaran Rp 99.247 melalui QRIS dari BUDI SANTOSO',
    packageName: 'id.dana.merchant',
  });
  assert.ok(res1);
  assert.equal(res1.amount, 99247);
  assert.equal(res1.senderName, 'BUDI SANTOSO');
  assert.equal(res1.providerPrefix, 'DANA');

  const res2 = parseDanaNotification({
    title: 'Pembayaran QRIS Berhasil',
    message: 'Pembayaran QRIS sebesar Rp149.518 berhasil diterima di AYAM PETOK-PETOK Ref: TRX8821A',
  });
  assert.ok(res2);
  assert.equal(res2.amount, 149518);
  assert.equal(res2.referenceId, 'TRX8821A');

  const resNeo = parseDanaNotification({
    title: 'Neobank',
    message: 'Anda menerima pembayaran QRIS sebesar Rp 75.312 dari SITI AMINAH di Neobank',
    packageName: 'com.bnc.finance',
  });
  assert.ok(resNeo);
  assert.equal(resNeo.amount, 75312);
  assert.equal(resNeo.senderName, 'SITI AMINAH');
  assert.equal(resNeo.providerPrefix, 'NEO');
  assert.ok(resNeo.referenceId.startsWith('NEO-'));
});

test('ignores outgoing DANA and Neobank transfer notifications', () => {
  const outgoing = parseDanaNotification({
    title: 'DANA',
    message: 'Kirim uang Rp 99.247 ke BCA berhasil',
  });
  assert.equal(outgoing, null);

  const neoOutgoing = parseDanaNotification({
    title: 'Neobank',
    message: 'Transfer ke BRI Rp 150.000 berhasil',
    packageName: 'com.bnc.finance',
  });
  assert.equal(neoOutgoing, null);
});

test('generates collision-free unique code across active pending orders', () => {
  const active = new Set<number>([99101, 99102, 99103]);
  const code = generateUniqueCode(active, 99000, 101, 105, () => 0);
  assert.equal(code, 104);
});

test('matches mutation strictly to active non-expired pending order', () => {
  const now = Date.parse('2026-11-22T10:00:00.000Z');
  const baseOrder: OrderRecord = {
    id: 'ord-1',
    orderCode: 'MP-1001',
    productId: 'prod-1',
    productName: 'E-Book',
    buyerName: 'Rina',
    buyerEmail: 'rina@example.com',
    buyerWhatsapp: '628123456789',
    baseAmount: 99000,
    uniqueCode: 247,
    totalAmount: 99247,
    dynamicQris: '000201...',
    status: 'PENDING',
    accessUrl: 'https://akses.example.com/ebook',
    licenseKey: 'EBK-1001-ABCD',
    matchedMutationId: null,
    createdAt: '2026-11-22T09:50:00.000Z',
    expiresAt: '2026-11-22T10:20:00.000Z',
    paidAt: null,
    emailDelivery: { status: 'PENDING', recipient: 'rina@example.com', provider: 'preview', messagePreview: '', sentAt: null },
    whatsappDelivery: { status: 'PENDING', recipient: '628123456789', provider: 'preview', messagePreview: '', sentAt: null },
  };

  const expiredOrder: OrderRecord = {
    ...baseOrder,
    id: 'ord-expired',
    orderCode: 'MP-1000',
    createdAt: '2026-11-22T09:00:00.000Z',
    expiresAt: '2026-11-22T09:30:00.000Z',
  };

  const paidOrder: OrderRecord = {
    ...baseOrder,
    id: 'ord-paid',
    status: 'PAID',
  };

  const matched = matchMutationToOrder(99247, [expiredOrder, paidOrder, baseOrder], now);
  assert.equal(matched?.id, 'ord-1');

  const noMatch = matchMutationToOrder(99999, [expiredOrder, paidOrder, baseOrder], now);
  assert.equal(noMatch, null);
});

test('normalizes Indonesian WhatsApp numbers and renders fulfillment templates', () => {
  assert.equal(normalizeWhatsappNumber('0812-3456-7890'), '6281234567890');
  assert.equal(normalizeWhatsappNumber('+62 813 9988 7766'), '6281399887766');

  const rendered = renderFulfillmentTemplate(
    'Halo {{nama_pembeli}}, akses {{nama_produk}} ({{nominal}}): {{link_akses}} | Lisensi: {{kunci_lisensi}}',
    {
      nama_pembeli: 'Budi',
      nama_produk: 'Template Notion',
      nominal: 'Rp 99.247',
      kode_pesanan: 'MP-2026',
      link_akses: 'https://akses.test/123',
      kunci_lisensi: 'NTM-2026-ABCD',
      merchant: 'AYAM PETOK-PETOK',
    }
  );
  assert.equal(
    rendered,
    'Halo Budi, akses Template Notion (Rp 99.247): https://akses.test/123 | Lisensi: NTM-2026-ABCD'
  );
});
