import type { QrisChannel, QrisProvider } from '../types';
import { DEFAULT_DANA_STATIC_QRIS, parseQrisMetadata } from './qris';

export interface QrisProviderPreset {
  id: QrisProvider;
  name: string;
  defaultPackageName: string;
  sampleNotification: string;
}

export const QRIS_PROVIDER_PRESETS: QrisProviderPreset[] = [
  {
    id: 'DANA_BISNIS',
    name: 'DANA Bisnis',
    defaultPackageName: 'id.dana.merchant',
    sampleNotification:
      'Kamu baru saja menerima pembayaran Rp 99.247 melalui QRIS dari BUDI SANTOSO',
  },
  {
    id: 'NEOBANK',
    name: 'Neobank (BNC)',
    defaultPackageName: 'com.bnc.finance',
    sampleNotification:
      'Anda menerima pembayaran QRIS sebesar Rp 99.247 dari BUDI SANTOSO di Neobank',
  },
  {
    id: 'GOPAY_MERCHANT',
    name: 'GoPay Merchant',
    defaultPackageName: 'com.gojek.resto',
    sampleNotification:
      'Pembayaran QRIS GoPay sebesar Rp 99.247 berhasil diterima dari BUDI SANTOSO',
  },
  {
    id: 'SHOPEEPAY_MERCHANT',
    name: 'ShopeePay Merchant',
    defaultPackageName: 'com.shopee.id.merchant',
    sampleNotification:
      'Kamu menerima pembayaran QRIS ShopeePay Rp 99.247 dari BUDI SANTOSO',
  },
  {
    id: 'BANK_QRIS',
    name: 'QRIS Bank (BCA / BRI / Mandiri)',
    defaultPackageName: 'id.co.bri.brimerchant',
    sampleNotification:
      'Pembayaran QRIS sebesar Rp 99.247 berhasil diterima dari BUDI SANTOSO',
  },
  {
    id: 'OTHER',
    name: 'QRIS Merchant Lainnya',
    defaultPackageName: 'com.qris.merchant',
    sampleNotification: 'Pembayaran QRIS Rp 99.247 berhasil diterima',
  },
];

export function getProviderPreset(provider: QrisProvider): QrisProviderPreset {
  return (
    QRIS_PROVIDER_PRESETS.find((p) => p.id === provider) ??
    QRIS_PROVIDER_PRESETS[QRIS_PROVIDER_PRESETS.length - 1]
  );
}

export function detectProviderFromQris(staticQris: string): QrisProvider {
  const meta = parseQrisMetadata(staticQris);
  const domain = meta.acquirerDomain.toUpperCase();
  if (domain.includes('DANA')) return 'DANA_BISNIS';
  if (domain.includes('BNC') || domain.includes('NEO') || domain.includes('YUDHA')) {
    return 'NEOBANK';
  }
  if (domain.includes('GOPAY') || domain.includes('GOJEK')) return 'GOPAY_MERCHANT';
  if (domain.includes('SHOPEE') || domain.includes('AIRPAY')) return 'SHOPEEPAY_MERCHANT';
  if (
    domain.includes('BCA') ||
    domain.includes('BRI') ||
    domain.includes('BNI') ||
    domain.includes('MANDIRI')
  ) {
    return 'BANK_QRIS';
  }
  return 'OTHER';
}

export function detectProviderNameFromPackage(packageName: string): string {
  const pkg = packageName.toLowerCase();
  if (pkg.includes('dana')) return 'DANA Bisnis';
  if (pkg.includes('bnc') || pkg.includes('neo')) return 'Neobank (BNC)';
  if (pkg.includes('gojek') || pkg.includes('gopay')) return 'GoPay Merchant';
  if (pkg.includes('shopee')) return 'ShopeePay Merchant';
  if (pkg.includes('bri') || pkg.includes('bca') || pkg.includes('mandiri') || pkg.includes('bni')) {
    return 'QRIS Bank';
  }
  return 'QRIS Merchant';
}

export function buildLockedQrisChannel(input: {
  id: string;
  label: string;
  provider?: QrisProvider;
  packageName?: string;
  staticQris: string;
  existingChannels?: QrisChannel[];
  createdAt?: string;
}): QrisChannel {
  const cleanedQris = input.staticQris.trim();
  const label = input.label.trim();

  if (!label || label.length < 2) {
    throw new Error('Nama / label channel QRIS minimal 2 karakter.');
  }
  if (!cleanedQris) {
    throw new Error('Payload string QRIS wajib diisi.');
  }

  const meta = parseQrisMetadata(cleanedQris);
  if (!meta.valid) {
    throw new Error(
      `String QRIS tidak valid (CRC terbaca: ${meta.crcProvided || '-'}, seharusnya: ${meta.crcExpected || '-'}).`
    );
  }

  if (input.existingChannels?.some((ch) => ch.staticQris === cleanedQris)) {
    throw new Error('Payload QRIS ini sudah terdaftar di daftar Multi-QRIS Anda.');
  }

  const provider = input.provider ?? detectProviderFromQris(cleanedQris);
  const preset = getProviderPreset(provider);
  const packageName = input.packageName?.trim() || preset.defaultPackageName;

  return {
    id: input.id,
    label,
    provider,
    providerName: preset.name,
    packageName,
    staticQris: cleanedQris,
    merchantName: meta.merchantName,
    merchantCity: meta.merchantCity,
    postalCode: meta.postalCode,
    nmid: meta.nmid,
    acquirerDomain: meta.acquirerDomain,
    merchantPan: meta.merchantPan,
    merchantCriteria: meta.merchantCriteria,
    mcc: meta.mcc,
    crc16: meta.crcProvided,
    locked: true,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function createDefaultDanaChannel(): QrisChannel {
  return buildLockedQrisChannel({
    id: 'qris_dana_default',
    label: 'DANA Bisnis Utama',
    provider: 'DANA_BISNIS',
    packageName: 'id.dana.merchant',
    staticQris: DEFAULT_DANA_STATIC_QRIS,
    createdAt: '2026-11-01T00:00:00.000Z',
  });
}

export function resolveActiveChannel(
  channels: QrisChannel[],
  requestedChannelId?: string | null,
  activeChannelId?: string | null
): QrisChannel {
  if (requestedChannelId) {
    const exact = channels.find((c) => c.id === requestedChannelId);
    if (exact) return exact;
  }
  if (activeChannelId) {
    const active = channels.find((c) => c.id === activeChannelId);
    if (active) return active;
  }
  return channels[0] ?? createDefaultDanaChannel();
}

export function maskQrisPayload(qris: string): string {
  const trimmed = qris.trim();
  if (trimmed.length <= 42) return trimmed;
  return `${trimmed.slice(0, 26)}••••••••••••${trimmed.slice(-16)}`;
}
