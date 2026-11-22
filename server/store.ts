import fs from 'fs';
import path from 'path';
import type {
  DigitalProduct,
  MerchantSettings,
  MutationRecord,
  OrderRecord,
  OutboundWebhookEndpoint,
  OutboundWebhookLog,
  QrisChannel,
} from '../src/types';
import { DEFAULT_DANA_STATIC_QRIS, generateDynamicQris, parseQrisMetadata } from '../src/lib/qris';
import {
  buildLockedQrisChannel,
  createDefaultDanaChannel,
  detectProviderFromQris,
  resolveActiveChannel,
} from '../src/lib/qrisChannels';

export interface StoreData {
  qrisChannels: QrisChannel[];
  products: DigitalProduct[];
  orders: OrderRecord[];
  mutations: MutationRecord[];
  webhooks: OutboundWebhookEndpoint[];
  webhookLogs: OutboundWebhookLog[];
  settings: MerchantSettings;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

const DEFAULT_SETTINGS: MerchantSettings = {
  activeQrisChannelId: 'qris_dana_default',
  staticQris: DEFAULT_DANA_STATIC_QRIS,
  expiryMinutes: 30,
  autoFulfillEnabled: true,
  emailSubjectTemplate: 'Akses Produk {{nama_produk}} — Pembayaran Terverifikasi ({{kode_pesanan}})',
  emailBodyTemplate: `Halo {{nama_pembeli}},

Pembayaran QRIS Anda sebesar {{nominal}} ke {{merchant}} telah diverifikasi otomatis oleh sistem kami.

Detail Akses Produk Digital:
• Produk: {{nama_produk}}
• Kode Pesanan: {{kode_pesanan}}
• Kunci Lisensi: {{kunci_lisensi}}
• Link Akses / Unduh: {{link_akses}}

Simpan email ini sebagai bukti pembelian resmi. Jika membutuhkan bantuan, balas email ini atau hubungi WhatsApp kami.

Terima kasih,
{{merchant}}`,
  whatsappTemplate: `Halo {{nama_pembeli}}!

Pembayaran QRIS Anda sebesar *{{nominal}}* ({{kode_pesanan}}) telah *TERVERIFIKASI OTOMATIS*.

*Akses Produk Anda:*
Produk: {{nama_produk}}
Lisensi: \`{{kunci_lisensi}}\`
Link Akses: {{link_akses}}

Terima kasih telah berbelanja di {{merchant}}.`,
};

function createSeedData(): StoreData {
  const now = Date.now();
  const min = 60_000;
  const defaultDanaChannel = createDefaultDanaChannel();

  const products: DigitalProduct[] = [
    {
      id: 'prod-ebook-qris',
      name: 'Blueprint Jualan Produk Digital & Otomasi QRIS',
      slug: 'blueprint-produk-digital',
      category: 'E-Book & Panduan',
      description:
        'Panduan lengkap 140 halaman membangun funnel produk digital, konversi halaman checkout, hingga sistem pengiriman akses otomatis tanpa biaya potongan payment gateway.',
      price: 99000,
      accessUrl: 'https://akses.ayampetokdigital.id/library/blueprint-qris-2026',
      licensePrefix: 'BLP',
      fileInfo: 'PDF 142 hal + Template Notion',
      active: true,
      createdAt: new Date(now - 14 * 24 * 60 * min).toISOString(),
    },
    {
      id: 'prod-template-kasir',
      name: 'Template Pembukuan UMKM & Rekonsiliasi DANA Bisnis',
      slug: 'template-pembukuan-umkm',
      category: 'Template Spreadsheet',
      description:
        'Workbook Google Sheets & Excel siap pakai dengan rumus rekonsiliasi otomatis mutasi QRIS harian, laporan laba rugi bulanan, dan stok bahan baku.',
      price: 149000,
      accessUrl: 'https://akses.ayampetokdigital.id/sheets/umkm-rekonsiliasi-v3',
      licensePrefix: 'UMK',
      fileInfo: 'Google Sheets + XLSX + Video 25m',
      active: true,
      createdAt: new Date(now - 9 * 24 * 60 * min).toISOString(),
    },
    {
      id: 'prod-kelas-wa',
      name: 'Mini Course Automasi WhatsApp & Email Follow-Up',
      slug: 'mini-course-automasi-wa',
      category: 'Kelas Video',
      description:
        '8 modul video praktis membangun webhook notifikasi Android MacroDroid, auto-reply WhatsApp, dan urutan email onboarding pelanggan secara real-time.',
      price: 249000,
      accessUrl: 'https://akses.ayampetokdigital.id/course/automasi-wa-email',
      licensePrefix: 'CRS',
      fileInfo: '8 Modul Video HD + Script JSON',
      active: true,
      createdAt: new Date(now - 4 * 24 * 60 * min).toISOString(),
    },
  ];

  const paidOrder1Total = 99214;
  const paidOrder2Total = 149388;
  const pendingOrderTotal = 249412;

  const orders: OrderRecord[] = [
    {
      id: 'ord-seed-003',
      orderCode: 'MP-261103',
      qrisChannelId: defaultDanaChannel.id,
      qrisChannelLabel: defaultDanaChannel.label,
      qrisProvider: defaultDanaChannel.provider,
      productId: products[2].id,
      productName: products[2].name,
      buyerName: 'Dimas Pratama',
      buyerEmail: 'dimas.pratama@contoh.id',
      buyerWhatsapp: '6281298765432',
      baseAmount: 249000,
      uniqueCode: 412,
      totalAmount: pendingOrderTotal,
      dynamicQris: generateDynamicQris(DEFAULT_DANA_STATIC_QRIS, pendingOrderTotal),
      status: 'PENDING',
      accessUrl: products[2].accessUrl,
      licenseKey: 'CRS-261103-K9M2',
      matchedMutationId: null,
      createdAt: new Date(now - 5 * min).toISOString(),
      expiresAt: new Date(now + 25 * min).toISOString(),
      paidAt: null,
      emailDelivery: {
        status: 'PENDING',
        recipient: 'dimas.pratama@contoh.id',
        provider: 'preview',
        messagePreview: '',
        sentAt: null,
      },
      whatsappDelivery: {
        status: 'PENDING',
        recipient: '6281298765432',
        provider: 'preview',
        messagePreview: '',
        sentAt: null,
      },
    },
    {
      id: 'ord-seed-002',
      orderCode: 'MP-261102',
      qrisChannelId: defaultDanaChannel.id,
      qrisChannelLabel: defaultDanaChannel.label,
      qrisProvider: defaultDanaChannel.provider,
      productId: products[1].id,
      productName: products[1].name,
      buyerName: 'Siti Nurhaliza',
      buyerEmail: 'siti.nur@contoh.id',
      buyerWhatsapp: '6285712349876',
      baseAmount: 149000,
      uniqueCode: 388,
      totalAmount: paidOrder2Total,
      dynamicQris: generateDynamicQris(DEFAULT_DANA_STATIC_QRIS, paidOrder2Total),
      status: 'PAID',
      accessUrl: products[1].accessUrl,
      licenseKey: 'UMK-261102-R4T8',
      matchedMutationId: 'mut-seed-002',
      createdAt: new Date(now - 42 * min).toISOString(),
      expiresAt: new Date(now - 12 * min).toISOString(),
      paidAt: new Date(now - 39 * min).toISOString(),
      emailDelivery: {
        status: 'SIMULATED_SENT',
        recipient: 'siti.nur@contoh.id',
        provider: 'preview',
        subject: 'Akses Produk Template Pembukuan UMKM & Rekonsiliasi DANA Bisnis — Pembayaran Terverifikasi (MP-261102)',
        messagePreview:
          'Halo Siti Nurhaliza, pembayaran QRIS Rp 149.388 ke AYAM PETOK-PETOK telah diverifikasi otomatis. Lisensi: UMK-261102-R4T8.',
        sentAt: new Date(now - 39 * min).toISOString(),
      },
      whatsappDelivery: {
        status: 'SIMULATED_SENT',
        recipient: '6285712349876',
        provider: 'preview',
        messagePreview:
          'Halo Siti Nurhaliza! Pembayaran QRIS Rp 149.388 (MP-261102) TERVERIFIKASI OTOMATIS. Link: https://akses.ayampetokdigital.id/sheets/umkm-rekonsiliasi-v3',
        sentAt: new Date(now - 39 * min).toISOString(),
      },
    },
    {
      id: 'ord-seed-001',
      orderCode: 'MP-261101',
      qrisChannelId: defaultDanaChannel.id,
      qrisChannelLabel: defaultDanaChannel.label,
      qrisProvider: defaultDanaChannel.provider,
      productId: products[0].id,
      productName: products[0].name,
      buyerName: 'Budi Santoso',
      buyerEmail: 'budi.santoso@contoh.id',
      buyerWhatsapp: '6281322334455',
      baseAmount: 99000,
      uniqueCode: 214,
      totalAmount: paidOrder1Total,
      dynamicQris: generateDynamicQris(DEFAULT_DANA_STATIC_QRIS, paidOrder1Total),
      status: 'PAID',
      accessUrl: products[0].accessUrl,
      licenseKey: 'BLP-261101-V7X1',
      matchedMutationId: 'mut-seed-001',
      createdAt: new Date(now - 115 * min).toISOString(),
      expiresAt: new Date(now - 85 * min).toISOString(),
      paidAt: new Date(now - 112 * min).toISOString(),
      emailDelivery: {
        status: 'SIMULATED_SENT',
        recipient: 'budi.santoso@contoh.id',
        provider: 'preview',
        subject: 'Akses Produk Blueprint Jualan Produk Digital & Otomasi QRIS — Pembayaran Terverifikasi (MP-261101)',
        messagePreview:
          'Halo Budi Santoso, pembayaran QRIS Rp 99.214 ke AYAM PETOK-PETOK telah diverifikasi otomatis. Lisensi: BLP-261101-V7X1.',
        sentAt: new Date(now - 112 * min).toISOString(),
      },
      whatsappDelivery: {
        status: 'SIMULATED_SENT',
        recipient: '6281322334455',
        provider: 'preview',
        messagePreview:
          'Halo Budi Santoso! Pembayaran QRIS Rp 99.214 (MP-261101) TERVERIFIKASI OTOMATIS. Link: https://akses.ayampetokdigital.id/library/blueprint-qris-2026',
        sentAt: new Date(now - 112 * min).toISOString(),
      },
    },
  ];

  const mutations: MutationRecord[] = [
    {
      id: 'mut-seed-002',
      source: 'DANA_WEBHOOK',
      packageName: 'id.dana.merchant',
      providerName: 'DANA Bisnis',
      title: 'DANA Bisnis — Pembayaran QRIS',
      rawMessage: 'Kamu baru saja menerima pembayaran Rp 149.388 melalui QRIS dari SITI NURHALIZA',
      amount: paidOrder2Total,
      senderName: 'SITI NURHALIZA',
      referenceId: 'DANA-9842A1',
      status: 'MATCHED',
      matchedOrderId: 'ord-seed-002',
      matchedOrderCode: 'MP-261102',
      receivedAt: new Date(now - 39 * min).toISOString(),
    },
    {
      id: 'mut-seed-001',
      source: 'DANA_WEBHOOK',
      packageName: 'id.dana.merchant',
      providerName: 'DANA Bisnis',
      title: 'DANA Bisnis — Pembayaran QRIS',
      rawMessage: 'Kamu baru saja menerima pembayaran Rp 99.214 melalui QRIS dari BUDI SANTOSO',
      amount: paidOrder1Total,
      senderName: 'BUDI SANTOSO',
      referenceId: 'DANA-9841F7',
      status: 'MATCHED',
      matchedOrderId: 'ord-seed-001',
      matchedOrderCode: 'MP-261101',
      receivedAt: new Date(now - 112 * min).toISOString(),
    },
    {
      id: 'mut-seed-000',
      source: 'DANA_WEBHOOK',
      packageName: 'id.dana.merchant',
      providerName: 'DANA Bisnis',
      title: 'DANA Bisnis — Pembayaran QRIS',
      rawMessage: 'Kamu baru saja menerima pembayaran Rp 25.000 melalui QRIS dari PELANGGAN TOKO',
      amount: 25000,
      senderName: 'PELANGGAN TOKO',
      referenceId: 'DANA-9839C3',
      status: 'UNMATCHED',
      matchedOrderId: null,
      matchedOrderCode: null,
      receivedAt: new Date(now - 180 * min).toISOString(),
    },
  ];

  return {
    qrisChannels: [defaultDanaChannel],
    products,
    orders,
    mutations,
    webhooks: [],
    webhookLogs: [],
    settings: DEFAULT_SETTINGS,
  };
}

let cachedStore: StoreData | null = null;

function hydrateChannelsAndSettings(
  parsedChannels: QrisChannel[] | undefined,
  parsedSettings: Partial<MerchantSettings> | undefined
): { qrisChannels: QrisChannel[]; settings: MerchantSettings } {
  let channels: QrisChannel[] = Array.isArray(parsedChannels)
    ? parsedChannels
        .filter((c) => c && typeof c.staticQris === 'string' && c.staticQris.trim().length > 0)
        .map((c) => ({ ...c, locked: true as const }))
    : [];

  if (channels.length === 0) {
    const defaultCh = createDefaultDanaChannel();
    channels = [defaultCh];

    const legacyQris = parsedSettings?.staticQris?.trim();
    if (legacyQris && legacyQris !== DEFAULT_DANA_STATIC_QRIS && parseQrisMetadata(legacyQris).valid) {
      try {
        const migrated = buildLockedQrisChannel({
          id: 'qris_migrated_custom',
          label: parseQrisMetadata(legacyQris).merchantName || 'QRIS Utama',
          provider: detectProviderFromQris(legacyQris),
          staticQris: legacyQris,
          existingChannels: channels,
        });
        channels.unshift(migrated);
      } catch {
        // Ignore if duplicate/invalid
      }
    }
  }

  const activeChannel = resolveActiveChannel(
    channels,
    null,
    parsedSettings?.activeQrisChannelId ?? channels[0].id
  );

  const settings: MerchantSettings = {
    ...DEFAULT_SETTINGS,
    ...parsedSettings,
    activeQrisChannelId: activeChannel.id,
    staticQris: activeChannel.staticQris,
  };

  return { qrisChannels: channels, settings };
}

export function loadStore(): StoreData {
  if (cachedStore) {
    refreshExpiredOrders(cachedStore);
    return cachedStore;
  }

  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      if (parsed && Array.isArray(parsed.products) && Array.isArray(parsed.orders)) {
        const { qrisChannels, settings } = hydrateChannelsAndSettings(
          parsed.qrisChannels,
          parsed.settings
        );
        const defaultChannel = resolveActiveChannel(qrisChannels, null, settings.activeQrisChannelId);
        cachedStore = {
          qrisChannels,
          products: parsed.products,
          orders: parsed.orders.map((o) => ({
            ...o,
            qrisChannelId: o.qrisChannelId ?? defaultChannel.id,
            qrisChannelLabel: o.qrisChannelLabel ?? defaultChannel.label,
            qrisProvider: o.qrisProvider ?? defaultChannel.provider,
          })),
          mutations: Array.isArray(parsed.mutations) ? parsed.mutations : [],
          webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [],
          webhookLogs: Array.isArray(parsed.webhookLogs) ? parsed.webhookLogs : [],
          settings,
        };
        refreshExpiredOrders(cachedStore);
        return cachedStore;
      }
    }
  } catch (err) {
    console.error('[store] Failed to read store.json, recreating seed data:', err);
  }

  cachedStore = createSeedData();
  saveStore(cachedStore);
  return cachedStore;
}

export function saveStore(data: StoreData): void {
  cachedStore = data;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, STORE_PATH);
}

export function refreshExpiredOrders(data: StoreData): boolean {
  const now = Date.now();
  let changed = false;
  for (const order of data.orders) {
    if (order.status === 'PENDING' && new Date(order.expiresAt).getTime() <= now) {
      order.status = 'EXPIRED';
      changed = true;
    }
  }
  if (changed) {
    saveStore(data);
  }
  return changed;
}
