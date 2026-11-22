import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { createServer as createViteServer } from 'vite';
import { loadStore, refreshExpiredOrders, saveStore } from './server/store';
import { dispatchDigitalFulfillment, getIntegrationStatus } from './server/fulfillment';
import {
  deliverWebhookToUrl,
  dispatchOutboundEvent,
  getOutboundSigningSecret,
  pingWebhookEndpoint,
} from './server/outboundWebhook';
import { buildOpenApiSpec } from './server/openapi';
import { generateDynamicQris, parseQrisMetadata } from './src/lib/qris';
import {
  buildLockedQrisChannel,
  detectProviderNameFromPackage,
  resolveActiveChannel,
} from './src/lib/qrisChannels';
import { parseDanaNotification } from './src/lib/mutationParser';
import { isValidWebhookUrl, verifyWebhookSignature } from './src/lib/webhookSigner';
import {
  generateLicenseKey,
  generateUniqueCode,
  matchMutationToOrder,
  normalizeWhatsappNumber,
} from './src/lib/matcher';
import type {
  DigitalProduct,
  MutationRecord,
  OrderRecord,
  OutboundWebhookEndpoint,
  QrisProvider,
  WebhookEventType,
} from './src/types';

interface RawBodyRequest extends Request {
  rawBody?: string;
}

const app = express();
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = buf.toString('utf8');
    },
  })
);

// Enable CORS for external application integrations calling /api/v1/*
app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-API-Key, X-Webhook-Secret'
  );
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

function requireExternalApiKey(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.EXTERNAL_API_KEY?.trim();
  if (!configuredKey) {
    next();
    return;
  }
  const provided =
    req.header('x-api-key')?.trim() ||
    req.header('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  if (provided !== configuredKey) {
    res.status(401).json({
      error: 'Unauthorized: header Authorization: Bearer <EXTERNAL_API_KEY> atau X-API-Key tidak valid.',
    });
    return;
  }
  next();
}

// Connected SSE clients for instant real-time updates (admin + buyer checkout)
const sseClients = new Set<Response>();

function broadcastEvent(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

function getBaseOrigin(req: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl) && !envUrl.includes('MY_APP_URL')) {
    return envUrl.replace(/\/+$/, '');
  }
  const proto = req.header('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol || 'http';
  const host = req.header('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function getSnapshotPayload() {
  const store = loadStore();
  refreshExpiredOrders(store);
  return {
    ...store,
    integration: getIntegrationStatus(),
  };
}

// SSE stream
app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Full dashboard snapshot
app.get('/api/snapshot', (_req: Request, res: Response) => {
  res.json(getSnapshotPayload());
});

// Render QR PNG/DataURL from any dynamic QRIS string
app.post('/api/qris/render', async (req: Request, res: Response) => {
  try {
    const qris = String(req.body?.qris ?? '').trim();
    if (!qris) {
      res.status(400).json({ error: 'String QRIS wajib diisi.' });
      return;
    }
    const dataUrl = await QRCode.toDataURL(qris, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    res.json({ dataUrl, metadata: parseQrisMetadata(qris) });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Gagal membuat gambar QRIS.',
    });
  }
});

// ============================================================================
// MULTI-QRIS CHANNEL REGISTRY (Permanently Locked Payloads Once Saved)
// ============================================================================

app.get('/api/qris-channels', (_req: Request, res: Response) => {
  const store = loadStore();
  res.json({
    channels: store.qrisChannels,
    activeQrisChannelId: store.settings.activeQrisChannelId,
  });
});

app.post('/api/qris-channels', (req: Request, res: Response) => {
  const store = loadStore();
  const label = String(req.body?.label ?? '').trim();
  const staticQris = String(req.body?.staticQris ?? '').trim();
  const provider = req.body?.provider ? (String(req.body.provider).trim() as QrisProvider) : undefined;
  const packageName = req.body?.packageName ? String(req.body.packageName).trim() : undefined;
  const setActive = Boolean(req.body?.setActive);

  try {
    const channel = buildLockedQrisChannel({
      id: `qris_${crypto.randomBytes(4).toString('hex')}`,
      label,
      provider,
      packageName,
      staticQris,
      existingChannels: store.qrisChannels,
    });

    store.qrisChannels.push(channel);
    if (setActive) {
      store.settings.activeQrisChannelId = channel.id;
      store.settings.staticQris = channel.staticQris;
    }

    saveStore(store);
    broadcastEvent('snapshot', getSnapshotPayload());
    res.status(201).json({
      channel,
      activeQrisChannelId: store.settings.activeQrisChannelId,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Gagal menambahkan channel QRIS.',
    });
  }
});

app.post('/api/qris-channels/:id/activate', (req: Request, res: Response) => {
  const store = loadStore();
  const channel = store.qrisChannels.find((c) => c.id === req.params.id);
  if (!channel) {
    res.status(404).json({ error: 'Channel QRIS tidak ditemukan.' });
    return;
  }

  store.settings.activeQrisChannelId = channel.id;
  store.settings.staticQris = channel.staticQris;
  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json({
    activeQrisChannelId: channel.id,
    channel,
  });
});

app.delete('/api/qris-channels/:id', (req: Request, res: Response) => {
  const store = loadStore();
  if (store.qrisChannels.length <= 1) {
    res.status(400).json({
      error: 'Minimal harus ada 1 channel QRIS aktif yang tersimpan.',
    });
    return;
  }

  const before = store.qrisChannels.length;
  store.qrisChannels = store.qrisChannels.filter((c) => c.id !== req.params.id);
  if (store.qrisChannels.length === before) {
    res.status(404).json({ error: 'Channel QRIS tidak ditemukan.' });
    return;
  }

  if (store.settings.activeQrisChannelId === req.params.id) {
    const fallback = store.qrisChannels[0];
    store.settings.activeQrisChannelId = fallback.id;
    store.settings.staticQris = fallback.staticQris;
  }

  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json({
    deleted: true,
    activeQrisChannelId: store.settings.activeQrisChannelId,
  });
});

// Digital Products CRUD
app.post('/api/products', (req: Request, res: Response) => {
  const store = loadStore();
  const name = String(req.body?.name ?? '').trim();
  const category = String(req.body?.category ?? 'Produk Digital').trim();
  const description = String(req.body?.description ?? '').trim();
  const price = Math.round(Number(req.body?.price ?? 0));
  const accessUrl = String(req.body?.accessUrl ?? '').trim();
  const licensePrefix = String(req.body?.licensePrefix ?? 'DIGI').trim().toUpperCase().slice(0, 6);
  const fileInfo = String(req.body?.fileInfo ?? 'Akses Instan').trim();

  if (!name || name.length < 3) {
    res.status(400).json({ error: 'Nama produk minimal 3 karakter.' });
    return;
  }
  if (!Number.isFinite(price) || price < 1000) {
    res.status(400).json({ error: 'Harga produk minimal Rp 1.000.' });
    return;
  }
  if (!accessUrl || !/^https?:\/\//i.test(accessUrl)) {
    res.status(400).json({ error: 'Link akses produk harus diawali https:// atau http://.' });
    return;
  }

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

  const product: DigitalProduct = {
    id: `prod-${crypto.randomBytes(4).toString('hex')}`,
    name,
    slug: `${slug || 'produk'}-${crypto.randomBytes(2).toString('hex')}`,
    category: category || 'Produk Digital',
    description: description || 'Produk digital dengan pengiriman akses otomatis setelah pembayaran QRIS.',
    price,
    accessUrl,
    licensePrefix: licensePrefix || 'DIGI',
    fileInfo: fileInfo || 'Akses Instan',
    active: true,
    createdAt: new Date().toISOString(),
  };

  store.products.unshift(product);
  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.status(201).json(product);
});

app.put('/api/products/:id', (req: Request, res: Response) => {
  const store = loadStore();
  const idx = store.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Produk tidak ditemukan.' });
    return;
  }

  const existing = store.products[idx];
  const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
  const price =
    req.body?.price !== undefined ? Math.round(Number(req.body.price)) : existing.price;
  const accessUrl =
    req.body?.accessUrl !== undefined ? String(req.body.accessUrl).trim() : existing.accessUrl;

  if (!name || name.length < 3) {
    res.status(400).json({ error: 'Nama produk minimal 3 karakter.' });
    return;
  }
  if (!Number.isFinite(price) || price < 1000) {
    res.status(400).json({ error: 'Harga produk minimal Rp 1.000.' });
    return;
  }
  if (!accessUrl || !/^https?:\/\//i.test(accessUrl)) {
    res.status(400).json({ error: 'Link akses produk harus berupa URL yang valid.' });
    return;
  }

  store.products[idx] = {
    ...existing,
    name,
    category:
      req.body?.category !== undefined ? String(req.body.category).trim() : existing.category,
    description:
      req.body?.description !== undefined
        ? String(req.body.description).trim()
        : existing.description,
    price,
    accessUrl,
    licensePrefix:
      req.body?.licensePrefix !== undefined
        ? String(req.body.licensePrefix).trim().toUpperCase().slice(0, 6)
        : existing.licensePrefix,
    fileInfo:
      req.body?.fileInfo !== undefined ? String(req.body.fileInfo).trim() : existing.fileInfo,
    active: req.body?.active !== undefined ? Boolean(req.body.active) : existing.active,
  };

  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json(store.products[idx]);
});

app.delete('/api/products/:id', (req: Request, res: Response) => {
  const store = loadStore();
  const before = store.products.length;
  store.products = store.products.filter((p) => p.id !== req.params.id);
  if (store.products.length === before) {
    res.status(404).json({ error: 'Produk tidak ditemukan.' });
    return;
  }
  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json({ deleted: true });
});

// Create Buyer Checkout Order + Generate Dynamic QRIS
app.post('/api/orders', async (req: Request, res: Response) => {
  const store = loadStore();
  refreshExpiredOrders(store);

  const productId = String(req.body?.productId ?? '').trim();
  const buyerName = String(req.body?.buyerName ?? '').trim();
  const buyerEmail = String(req.body?.buyerEmail ?? '').trim();
  const rawWhatsapp = String(req.body?.buyerWhatsapp ?? '').trim();
  const requestedChannelId = req.body?.qrisChannelId ? String(req.body.qrisChannelId).trim() : null;
  const returnUrl = req.body?.returnUrl ? String(req.body.returnUrl).trim() : null;

  const product = store.products.find((p) => p.id === productId);
  if (!product) {
    res.status(404).json({ error: 'Produk digital tidak ditemukan.' });
    return;
  }
  if (!buyerName || buyerName.length < 2) {
    res.status(400).json({ error: 'Nama pembeli wajib diisi (minimal 2 karakter).' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    res.status(400).json({ error: 'Alamat email pembeli tidak valid.' });
    return;
  }
  const normalizedWa = normalizeWhatsappNumber(rawWhatsapp);
  if (normalizedWa.length < 10 || normalizedWa.length > 15) {
    res.status(400).json({ error: 'Nomor WhatsApp tidak valid (contoh: 081234567890).' });
    return;
  }
  if (returnUrl && !/^https?:\/\//i.test(returnUrl)) {
    res.status(400).json({ error: 'returnUrl harus diawali https:// atau http://.' });
    return;
  }

  const activeAmounts = new Set(
    store.orders.filter((o) => o.status === 'PENDING').map((o) => o.totalAmount)
  );

  try {
    const channel = resolveActiveChannel(
      store.qrisChannels,
      requestedChannelId,
      store.settings.activeQrisChannelId
    );
    const uniqueCode = generateUniqueCode(activeAmounts, product.price);
    const totalAmount = product.price + uniqueCode;
    const dynamicQris = generateDynamicQris(channel.staticQris, totalAmount);

    const now = Date.now();
    const orderNumber = String(store.orders.length + 101).padStart(4, '0');
    const orderCode = `MP-${new Date(now).toISOString().slice(2, 10).replace(/-/g, '').slice(0, 4)}${orderNumber.slice(-2)}`;

    const order: OrderRecord = {
      id: `ord-${crypto.randomBytes(5).toString('hex')}`,
      orderCode,
      returnUrl,
      qrisChannelId: channel.id,
      qrisChannelLabel: channel.label,
      qrisProvider: channel.provider,
      productId: product.id,
      productName: product.name,
      buyerName,
      buyerEmail,
      buyerWhatsapp: normalizedWa,
      baseAmount: product.price,
      uniqueCode,
      totalAmount,
      dynamicQris,
      status: 'PENDING',
      accessUrl: product.accessUrl,
      licenseKey: generateLicenseKey(product.licensePrefix, orderCode),
      matchedMutationId: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + store.settings.expiryMinutes * 60_000).toISOString(),
      paidAt: null,
      emailDelivery: {
        status: 'PENDING',
        recipient: buyerEmail,
        provider: getIntegrationStatus().emailProvider,
        messagePreview: '',
        sentAt: null,
      },
      whatsappDelivery: {
        status: 'PENDING',
        recipient: normalizedWa,
        provider: getIntegrationStatus().whatsappProvider,
        messagePreview: '',
        sentAt: null,
      },
    };

    store.orders.unshift(order);
    saveStore(store);

    const qrDataUrl = await QRCode.toDataURL(dynamicQris, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    const paymentUrl = `${getBaseOrigin(req)}/?pay=${encodeURIComponent(order.orderCode)}`;

    dispatchOutboundEvent('payment.created', { ...order, payment_url: paymentUrl }, order.callbackUrl).then(() => {
      broadcastEvent('snapshot', getSnapshotPayload());
    });
    broadcastEvent('snapshot', getSnapshotPayload());
    res.status(201).json({ order, qrDataUrl, paymentUrl, channel });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Gagal membuat pesanan QRIS.',
    });
  }
});

// Get single order (used by buyer checkout polling/hydration)
app.get('/api/orders/:id', async (req: Request, res: Response) => {
  const store = loadStore();
  refreshExpiredOrders(store);
  const order = store.orders.find((o) => o.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    return;
  }
  const qrDataUrl = await QRCode.toDataURL(order.dynamicQris, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });
  res.json({ order, qrDataUrl });
});

// Public Hosted Payment Page lookup (Midtrans / Duitku / Xendit style)
app.get('/api/pay/:codeOrId', async (req: Request, res: Response) => {
  const store = loadStore();
  refreshExpiredOrders(store);
  const key = req.params.codeOrId;
  const order = store.orders.find(
    (o) => o.orderCode === key || o.id === key || (o.externalId && o.externalId === key)
  );
  if (!order) {
    res.status(404).json({ error: 'Halaman pembayaran tidak ditemukan.' });
    return;
  }

  const channel = resolveActiveChannel(
    store.qrisChannels,
    order.qrisChannelId,
    store.settings.activeQrisChannelId
  );
  const qrMeta = parseQrisMetadata(order.dynamicQris);
  const qrDataUrl = await QRCode.toDataURL(order.dynamicQris, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 340,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });

  res.json({
    payment: {
      id: order.id,
      orderCode: order.orderCode,
      externalId: order.externalId ?? null,
      returnUrl: order.returnUrl ?? null,
      productName: order.productName,
      buyerName: order.buyerName,
      buyerEmail: order.buyerEmail,
      buyerWhatsapp: order.buyerWhatsapp,
      baseAmount: order.baseAmount,
      uniqueCode: order.uniqueCode,
      totalAmount: order.totalAmount,
      dynamicQris: order.dynamicQris,
      status: order.status,
      accessUrl: order.status === 'PAID' ? order.accessUrl : null,
      licenseKey: order.status === 'PAID' ? order.licenseKey : null,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      paidAt: order.paidAt,
      emailDeliveryStatus: order.emailDelivery.status,
      whatsappDeliveryStatus: order.whatsappDelivery.status,
    },
    channel: {
      id: channel.id,
      label: order.qrisChannelLabel ?? channel.label,
      provider: order.qrisProvider ?? channel.provider,
      providerName: channel.providerName,
      packageName: channel.packageName,
      merchantName: qrMeta.merchantName || channel.merchantName,
      merchantCity: qrMeta.merchantCity || channel.merchantCity,
      nmid: qrMeta.nmid || channel.nmid,
    },
    qrDataUrl,
  });
});

// Resend Email & WhatsApp fulfillment for a paid order
app.post('/api/orders/:id/resend', async (req: Request, res: Response) => {
  const store = loadStore();
  const order = store.orders.find((o) => o.id === req.params.id);
  if (!order) {
    res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    return;
  }
  if (order.status !== 'PAID') {
    res.status(400).json({ error: 'Akses hanya dapat dikirim untuk pesanan berstatus terverifikasi.' });
    return;
  }

  const fulfillment = await dispatchDigitalFulfillment(order, store.settings);
  order.emailDelivery = fulfillment.emailDelivery;
  order.whatsappDelivery = fulfillment.whatsappDelivery;
  saveStore(store);

  broadcastEvent('order_updated', order);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json({ order });
});

// Shared incoming mutation processor
async function processIncomingDanaMutation(
  req: Request,
  res: Response,
  source: 'DANA_WEBHOOK' | 'MANUAL_SIMULATION'
) {
  const store = loadStore();
  refreshExpiredOrders(store);

  const title = String(req.body?.title ?? 'DANA Bisnis — Pembayaran QRIS').trim();
  const message = String(req.body?.message ?? req.body?.text ?? '').trim();
  const packageName = String(req.body?.packageName ?? req.body?.package_name ?? 'id.dana.merchant').trim();
  const explicitAmount =
    req.body?.amount !== undefined && req.body?.amount !== ''
      ? Number(req.body.amount)
      : undefined;
  const senderName = req.body?.senderName ? String(req.body.senderName) : undefined;
  const referenceId = req.body?.referenceId ? String(req.body.referenceId) : undefined;

  if (!message && (!explicitAmount || Number.isNaN(explicitAmount))) {
    res.status(400).json({
      error: 'Pesan notifikasi DANA Bisnis atau nominal pembayaran wajib diisi.',
    });
    return;
  }

  const parsed = parseDanaNotification({
    title,
    message:
      message ||
      `Kamu baru saja menerima pembayaran Rp ${new Intl.NumberFormat('id-ID').format(explicitAmount || 0)} melalui QRIS${senderName ? ` dari ${senderName}` : ''}`,
    packageName,
    amount: explicitAmount,
    senderName,
    referenceId,
  });

  if (!parsed) {
    res.status(422).json({
      error:
        'Notifikasi tidak dikenali sebagai pembayaran masuk QRIS DANA Bisnis (atau merupakan transaksi keluar).',
    });
    return;
  }

  const matchedOrder = matchMutationToOrder(parsed.amount, store.orders, Date.now());

  const mutation: MutationRecord = {
    id: `mut-${crypto.randomBytes(5).toString('hex')}`,
    source,
    packageName,
    providerName: detectProviderNameFromPackage(packageName),
    title,
    rawMessage:
      message ||
      `Kamu baru saja menerima pembayaran Rp ${new Intl.NumberFormat('id-ID').format(parsed.amount)} melalui QRIS dari ${parsed.senderName}`,
    amount: parsed.amount,
    senderName: parsed.senderName,
    referenceId: parsed.referenceId,
    status: matchedOrder ? 'MATCHED' : 'UNMATCHED',
    matchedOrderId: matchedOrder?.id ?? null,
    matchedOrderCode: matchedOrder?.orderCode ?? null,
    receivedAt: new Date().toISOString(),
  };

  store.mutations.unshift(mutation);

  if (matchedOrder) {
    matchedOrder.status = 'PAID';
    matchedOrder.paidAt = mutation.receivedAt;
    matchedOrder.matchedMutationId = mutation.id;

    if (store.settings.autoFulfillEnabled && matchedOrder.fulfillmentMode !== 'EXTERNAL_ONLY') {
      const fulfillment = await dispatchDigitalFulfillment(matchedOrder, store.settings);
      matchedOrder.emailDelivery = fulfillment.emailDelivery;
      matchedOrder.whatsappDelivery = fulfillment.whatsappDelivery;
    }

    broadcastEvent('order_paid', matchedOrder);
  }

  saveStore(store);
  broadcastEvent('mutation_received', mutation);
  broadcastEvent('snapshot', getSnapshotPayload());

  // Fire outbound webhooks to external applications asynchronously
  const outboundJobs: Promise<unknown>[] = [dispatchOutboundEvent('mutation.received', mutation)];
  if (matchedOrder) {
    outboundJobs.push(
      dispatchOutboundEvent(
        'payment.paid',
        {
          order_id: matchedOrder.id,
          order_code: matchedOrder.orderCode,
          external_id: matchedOrder.externalId ?? null,
          fulfillment_mode: matchedOrder.fulfillmentMode ?? 'BOTH',
          metadata: matchedOrder.metadata ?? null,
          qris_channel_id: matchedOrder.qrisChannelId ?? null,
          qris_channel_label: matchedOrder.qrisChannelLabel ?? null,
          qris_provider: matchedOrder.qrisProvider ?? null,
          status: matchedOrder.status,
          product_id: matchedOrder.productId,
          product_name: matchedOrder.productName,
          buyer_name: matchedOrder.buyerName,
          buyer_email: matchedOrder.buyerEmail,
          buyer_whatsapp: matchedOrder.buyerWhatsapp,
          base_amount: matchedOrder.baseAmount,
          unique_code: matchedOrder.uniqueCode,
          total_amount: matchedOrder.totalAmount,
          access_url: matchedOrder.accessUrl,
          license_key: matchedOrder.licenseKey,
          paid_at: matchedOrder.paidAt,
          mutation_reference: mutation.referenceId,
          mutation_provider: mutation.providerName ?? detectProviderNameFromPackage(mutation.packageName),
        },
        matchedOrder.callbackUrl
      )
    );
  }
  Promise.allSettled(outboundJobs).then(() => {
    broadcastEvent('snapshot', getSnapshotPayload());
  });

  res.status(201).json({
    mutation,
    matchedOrder,
  });
}

// External Android Notification Listener Webhook (MacroDroid / Tasker / AutoNotification)
app.post('/api/webhook/dana', async (req: Request, res: Response) => {
  const configuredSecret = process.env.WEBHOOK_SECRET?.trim();
  if (configuredSecret) {
    const provided =
      req.header('x-webhook-secret') ||
      req.header('authorization')?.replace(/^Bearer\s+/i, '') ||
      String(req.query.secret ?? '');
    if (provided !== configuredSecret) {
      res.status(401).json({ error: 'Header X-Webhook-Secret tidak valid.' });
      return;
    }
  }
  await processIncomingDanaMutation(req, res, 'DANA_WEBHOOK');
});

// In-app test simulator for merchant to verify end-to-end auto-matching & delivery
app.post('/api/simulate/dana-webhook', async (req: Request, res: Response) => {
  await processIncomingDanaMutation(req, res, 'MANUAL_SIMULATION');
});

// Manual fallback match (links an UNMATCHED mutation to a PENDING/EXPIRED order and delivers access)
app.post('/api/mutations/:mutationId/match/:orderId', async (req: Request, res: Response) => {
  const store = loadStore();
  const mutation = store.mutations.find((m) => m.id === req.params.mutationId);
  const order = store.orders.find((o) => o.id === req.params.orderId);

  if (!mutation || !order) {
    res.status(404).json({ error: 'Mutasi atau pesanan tidak ditemukan.' });
    return;
  }

  mutation.status = 'MATCHED';
  mutation.matchedOrderId = order.id;
  mutation.matchedOrderCode = order.orderCode;

  order.status = 'PAID';
  order.paidAt = new Date().toISOString();
  order.matchedMutationId = mutation.id;

  if (order.fulfillmentMode !== 'EXTERNAL_ONLY') {
    const fulfillment = await dispatchDigitalFulfillment(order, store.settings);
    order.emailDelivery = fulfillment.emailDelivery;
    order.whatsappDelivery = fulfillment.whatsappDelivery;
  }

  saveStore(store);
  broadcastEvent('order_paid', order);
  broadcastEvent('snapshot', getSnapshotPayload());

  dispatchOutboundEvent(
    'payment.paid',
    {
      order_id: order.id,
      order_code: order.orderCode,
      external_id: order.externalId ?? null,
      fulfillment_mode: order.fulfillmentMode ?? 'BOTH',
      metadata: order.metadata ?? null,
      qris_channel_id: order.qrisChannelId ?? null,
      qris_channel_label: order.qrisChannelLabel ?? null,
      qris_provider: order.qrisProvider ?? null,
      status: order.status,
      product_id: order.productId,
      product_name: order.productName,
      buyer_name: order.buyerName,
      buyer_email: order.buyerEmail,
      buyer_whatsapp: order.buyerWhatsapp,
      total_amount: order.totalAmount,
      access_url: order.accessUrl,
      license_key: order.licenseKey,
      paid_at: order.paidAt,
      mutation_reference: mutation.referenceId,
    },
    order.callbackUrl
  ).then(() => {
    broadcastEvent('snapshot', getSnapshotPayload());
  });

  res.json({ mutation, order });
});

// Update merchant fulfillment templates & expiry settings (saved QRIS payloads are permanently locked!)
app.put('/api/settings', (req: Request, res: Response) => {
  const store = loadStore();
  const activeChannel = resolveActiveChannel(
    store.qrisChannels,
    null,
    store.settings.activeQrisChannelId
  );

  // Enforce permanent immutability: saved QRIS payloads cannot be modified via settings
  if (
    req.body?.staticQris !== undefined &&
    String(req.body.staticQris).trim() !== activeChannel.staticQris
  ) {
    res.status(403).json({
      error:
        'Payload QRIS yang sudah tersimpan terkunci permanen dan tidak dapat diedit. Tambahkan channel baru di daftar Multi-QRIS jika ingin menggunakan QRIS lain.',
    });
    return;
  }

  const expiryMinutes =
    req.body?.expiryMinutes !== undefined
      ? Math.min(180, Math.max(5, Math.round(Number(req.body.expiryMinutes))))
      : store.settings.expiryMinutes;

  store.settings = {
    activeQrisChannelId: activeChannel.id,
    staticQris: activeChannel.staticQris,
    expiryMinutes: Number.isNaN(expiryMinutes) ? 30 : expiryMinutes,
    autoFulfillEnabled:
      req.body?.autoFulfillEnabled !== undefined
        ? Boolean(req.body.autoFulfillEnabled)
        : store.settings.autoFulfillEnabled,
    emailSubjectTemplate:
      req.body?.emailSubjectTemplate !== undefined
        ? String(req.body.emailSubjectTemplate)
        : store.settings.emailSubjectTemplate,
    emailBodyTemplate:
      req.body?.emailBodyTemplate !== undefined
        ? String(req.body.emailBodyTemplate)
        : store.settings.emailBodyTemplate,
    whatsappTemplate:
      req.body?.whatsappTemplate !== undefined
        ? String(req.body.whatsappTemplate)
        : store.settings.whatsappTemplate,
  };

  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json(store.settings);
});

// ============================================================================
// OUTBOUND WEBHOOK MANAGEMENT (Admin Dashboard CRUD + Ping + Retry)
// ============================================================================

const ALLOWED_EVENTS: WebhookEventType[] = [
  'payment.created',
  'payment.paid',
  'payment.expired',
  'mutation.received',
];

app.get('/api/webhooks', (_req: Request, res: Response) => {
  const store = loadStore();
  res.json({ webhooks: store.webhooks, logs: store.webhookLogs });
});

app.post('/api/webhooks', (req: Request, res: Response) => {
  const store = loadStore();
  const name = String(req.body?.name ?? '').trim();
  const url = String(req.body?.url ?? '').trim();
  const rawEvents = Array.isArray(req.body?.events) ? req.body.events : [];
  const events = rawEvents.filter((ev: unknown): ev is WebhookEventType =>
    ALLOWED_EVENTS.includes(ev as WebhookEventType)
  );

  if (!name || name.length < 2) {
    res.status(400).json({ error: 'Nama integrasi / aplikasi minimal 2 karakter.' });
    return;
  }
  if (!isValidWebhookUrl(url)) {
    res.status(400).json({ error: 'URL Webhook harus berupa alamat http:// atau https:// yang valid.' });
    return;
  }
  if (events.length === 0) {
    res.status(400).json({ error: 'Pilih minimal satu event webhook.' });
    return;
  }

  const endpoint: OutboundWebhookEndpoint = {
    id: `wh_${crypto.randomBytes(4).toString('hex')}`,
    name,
    url,
    events,
    active: true,
    createdAt: new Date().toISOString(),
  };

  store.webhooks.unshift(endpoint);
  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.status(201).json(endpoint);
});

app.patch('/api/webhooks/:id', (req: Request, res: Response) => {
  const store = loadStore();
  const ep = store.webhooks.find((w) => w.id === req.params.id);
  if (!ep) {
    res.status(404).json({ error: 'Endpoint webhook tidak ditemukan.' });
    return;
  }
  if (req.body?.active !== undefined) ep.active = Boolean(req.body.active);
  if (req.body?.name !== undefined) ep.name = String(req.body.name).trim() || ep.name;
  if (req.body?.url !== undefined) {
    const nextUrl = String(req.body.url).trim();
    if (!isValidWebhookUrl(nextUrl)) {
      res.status(400).json({ error: 'URL Webhook tidak valid.' });
      return;
    }
    ep.url = nextUrl;
  }
  if (Array.isArray(req.body?.events)) {
    const validEvents = req.body.events.filter((ev: unknown): ev is WebhookEventType =>
      ALLOWED_EVENTS.includes(ev as WebhookEventType)
    );
    if (validEvents.length > 0) ep.events = validEvents;
  }
  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json(ep);
});

app.delete('/api/webhooks/:id', (req: Request, res: Response) => {
  const store = loadStore();
  const before = store.webhooks.length;
  store.webhooks = store.webhooks.filter((w) => w.id !== req.params.id);
  if (store.webhooks.length === before) {
    res.status(404).json({ error: 'Endpoint webhook tidak ditemukan.' });
    return;
  }
  saveStore(store);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json({ deleted: true });
});

app.post('/api/webhooks/:id/ping', async (req: Request, res: Response) => {
  const store = loadStore();
  const ep = store.webhooks.find((w) => w.id === req.params.id);
  if (!ep) {
    res.status(404).json({ error: 'Endpoint webhook tidak ditemukan.' });
    return;
  }
  const log = await pingWebhookEndpoint(ep);
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json({ log });
});

app.post('/api/webhook-logs/:logId/retry', async (req: Request, res: Response) => {
  const store = loadStore();
  const original = store.webhookLogs.find((l) => l.id === req.params.logId);
  if (!original) {
    res.status(404).json({ error: 'Riwayat webhook tidak ditemukan.' });
    return;
  }
  let parsedData: unknown = {};
  try {
    const parsedEnvelope = JSON.parse(original.payloadJson);
    parsedData = parsedEnvelope.data ?? parsedEnvelope;
  } catch {
    parsedData = { raw: original.payloadJson };
  }

  const log = await deliverWebhookToUrl({
    endpointId: original.endpointId,
    endpointName: original.endpointName,
    url: original.url,
    event: original.event,
    data: parsedData,
  });
  broadcastEvent('snapshot', getSnapshotPayload());
  res.json({ log });
});

// ============================================================================
// PUBLIC EXTERNAL REST API v1 (/api/v1/*)
// ============================================================================

app.get('/api/v1/openapi.json', (req: Request, res: Response) => {
  const proto = req.header('x-forwarded-proto') || req.protocol || 'http';
  const host = req.header('host') || 'localhost:3000';
  res.json(buildOpenApiSpec(`${proto}://${host}`));
});

// Built-in Echo Receiver to verify outbound webhook delivery & HMAC-SHA256 signatures
app.post('/api/v1/webhook-echo', (req: RawBodyRequest, res: Response) => {
  const timestamp = req.header('x-mutasipay-timestamp') || '';
  const signature = req.header('x-mutasipay-signature') || '';
  const event = req.header('x-mutasipay-event') || 'unknown';
  const deliveryId = req.header('x-mutasipay-delivery') || '';
  const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
  const signatureValid = verifyWebhookSignature(
    rawBody,
    timestamp,
    signature,
    getOutboundSigningSecret()
  );

  res.json({
    ok: true,
    received_at: new Date().toISOString(),
    event,
    delivery_id: deliveryId,
    signature_valid: signatureValid,
  });
});

// Unified Multi-QRIS Android Notification Webhook (DANA Bisnis, Neobank BNC, GoPay, ShopeePay)
async function handleIncomingWebhookWithSecret(req: Request, res: Response) {
  const configuredSecret = process.env.WEBHOOK_SECRET?.trim();
  if (configuredSecret) {
    const provided =
      req.header('x-webhook-secret') ||
      req.header('authorization')?.replace(/^Bearer\s+/i, '') ||
      String(req.query.secret ?? '');
    if (provided !== configuredSecret) {
      res.status(401).json({ error: 'Header X-Webhook-Secret tidak valid.' });
      return;
    }
  }
  await processIncomingDanaMutation(req, res, 'DANA_WEBHOOK');
}

app.post('/api/v1/webhooks/mutation', handleIncomingWebhookWithSecret);
app.post('/api/v1/webhooks/dana', handleIncomingWebhookWithSecret);

app.get('/api/v1/health', requireExternalApiKey, (_req: Request, res: Response) => {
  const store = loadStore();
  const activeChannel = resolveActiveChannel(
    store.qrisChannels,
    null,
    store.settings.activeQrisChannelId
  );
  const meta = parseQrisMetadata(activeChannel.staticQris);
  res.json({
    status: 'ok',
    service: 'MutasiPay Multi-QRIS Payment Gateway API',
    version: '1.1.0',
    channels_count: store.qrisChannels.length,
    active_channel: {
      id: activeChannel.id,
      label: activeChannel.label,
      provider: activeChannel.provider,
      provider_name: activeChannel.providerName,
      package_name: activeChannel.packageName,
      locked: activeChannel.locked,
    },
    merchant: {
      name: meta.merchantName,
      city: meta.merchantCity,
      nmid: meta.nmid,
      acquirer: meta.acquirerDomain,
      crc_valid: meta.valid,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/channels', requireExternalApiKey, (_req: Request, res: Response) => {
  const store = loadStore();
  res.json({
    active_channel_id: store.settings.activeQrisChannelId,
    count: store.qrisChannels.length,
    channels: store.qrisChannels.map((ch) => ({
      id: ch.id,
      label: ch.label,
      provider: ch.provider,
      provider_name: ch.providerName,
      package_name: ch.packageName,
      merchant_name: ch.merchantName,
      merchant_city: ch.merchantCity,
      nmid: ch.nmid,
      acquirer_domain: ch.acquirerDomain,
      crc16: ch.crc16,
      locked: ch.locked,
      is_active: ch.id === store.settings.activeQrisChannelId,
      created_at: ch.createdAt,
    })),
  });
});

app.get('/api/v1/products', requireExternalApiKey, (_req: Request, res: Response) => {
  const store = loadStore();
  res.json({
    products: store.products
      .filter((p) => p.active)
      .map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        category: p.category,
        price: p.price,
        file_info: p.fileInfo,
      })),
  });
});

// Standalone Dynamic QRIS Generator API (supports optional qris_channel_id)
app.post('/api/v1/qris/dynamic', requireExternalApiKey, async (req: Request, res: Response) => {
  const store = loadStore();
  refreshExpiredOrders(store);

  const directAmount =
    req.body?.amount !== undefined ? Math.round(Number(req.body.amount)) : null;
  const baseAmount =
    req.body?.base_amount !== undefined ? Math.round(Number(req.body.base_amount)) : null;
  const withUniqueCode = Boolean(req.body?.with_unique_code);
  const requestedChannelId = req.body?.qris_channel_id
    ? String(req.body.qris_channel_id).trim()
    : null;

  let finalAmount = directAmount ?? baseAmount ?? 0;
  let uniqueCode = 0;

  if (!Number.isFinite(finalAmount) || finalAmount < 100) {
    res.status(400).json({ error: 'Parameter amount atau base_amount minimal Rp 100.' });
    return;
  }

  try {
    const channel = resolveActiveChannel(
      store.qrisChannels,
      requestedChannelId,
      store.settings.activeQrisChannelId
    );
    if (withUniqueCode && baseAmount !== null) {
      const activeAmounts = new Set(
        store.orders.filter((o) => o.status === 'PENDING').map((o) => o.totalAmount)
      );
      uniqueCode = generateUniqueCode(activeAmounts, baseAmount);
      finalAmount = baseAmount + uniqueCode;
    }

    const qrisString = generateDynamicQris(channel.staticQris, finalAmount);
    const meta = parseQrisMetadata(qrisString);
    const qrImageDataUrl = await QRCode.toDataURL(qrisString, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });

    res.json({
      amount: finalAmount,
      base_amount: baseAmount ?? finalAmount,
      unique_code: uniqueCode,
      qris_string: qrisString,
      qr_image_data_url: qrImageDataUrl,
      crc16: meta.crcProvided,
      channel: {
        id: channel.id,
        label: channel.label,
        provider: channel.provider,
        provider_name: channel.providerName,
      },
      merchant: {
        name: meta.merchantName,
        city: meta.merchantCity,
        nmid: meta.nmid,
        acquirer: meta.acquirerDomain,
      },
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Gagal membuat QRIS dinamis.',
    });
  }
});

// Create tracked payment from external app (Midtrans / Duitku / Xendit style with Hosted Payment URL)
app.post('/api/v1/payments', requireExternalApiKey, async (req: Request, res: Response) => {
  const store = loadStore();
  refreshExpiredOrders(store);

  const productId = String(req.body?.product_id ?? '').trim();
  const externalId = req.body?.external_id ? String(req.body.external_id).trim() : null;
  const callbackUrl = req.body?.callback_url ? String(req.body.callback_url).trim() : null;
  const returnUrl = req.body?.return_url ? String(req.body.return_url).trim() : null;
  const rawFulfillmentMode = String(req.body?.fulfillment_mode ?? 'BOTH').toUpperCase();
  const fulfillmentMode: 'BOTH' | 'EXTERNAL_ONLY' =
    rawFulfillmentMode === 'EXTERNAL_ONLY' ? 'EXTERNAL_ONLY' : 'BOTH';
  const rawMetadata = req.body?.metadata;
  let metadata: Record<string, unknown> | null = null;
  if (rawMetadata !== undefined && rawMetadata !== null) {
    if (typeof rawMetadata !== 'object' || Array.isArray(rawMetadata)) {
      res.status(400).json({ error: 'Parameter metadata harus berupa objek JSON.' });
      return;
    }
    const serialized = JSON.stringify(rawMetadata);
    if (serialized.length > 4096) {
      res.status(400).json({ error: 'Ukuran parameter metadata maksimal 4 KB.' });
      return;
    }
    metadata = rawMetadata as Record<string, unknown>;
  }
  const requestedChannelId = req.body?.qris_channel_id
    ? String(req.body.qris_channel_id).trim()
    : null;
  const buyerName = String(req.body?.buyer_name ?? '').trim();
  const buyerEmail = String(req.body?.buyer_email ?? '').trim();
  const rawWhatsapp = String(req.body?.buyer_whatsapp ?? '').trim();

  if (callbackUrl && !isValidWebhookUrl(callbackUrl)) {
    res.status(400).json({ error: 'Parameter callback_url harus berupa URL http/https yang valid.' });
    return;
  }
  if (returnUrl && !/^https?:\/\//i.test(returnUrl)) {
    res.status(400).json({ error: 'Parameter return_url harus berupa URL http/https yang valid.' });
    return;
  }

  const matchedProduct = productId ? store.products.find((p) => p.id === productId) : undefined;
  const productName =
    matchedProduct?.name || String(req.body?.product_name ?? '').trim() || 'Pembayaran Produk Digital';
  const basePrice =
    matchedProduct?.price ?? Math.round(Number(req.body?.amount ?? 0));
  const accessUrl =
    String(req.body?.access_url ?? '').trim() ||
    matchedProduct?.accessUrl ||
    'https://akses.ayampetokdigital.id/order';
  const licensePrefix = matchedProduct?.licensePrefix || 'EXT';

  if (!Number.isFinite(basePrice) || basePrice < 1000) {
    res.status(400).json({ error: 'Nominal pembayaran (amount atau product_id) minimal Rp 1.000.' });
    return;
  }
  if (!buyerName || buyerName.length < 2) {
    res.status(400).json({ error: 'buyer_name wajib diisi (minimal 2 karakter).' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
    res.status(400).json({ error: 'buyer_email tidak valid.' });
    return;
  }
  const normalizedWa = normalizeWhatsappNumber(rawWhatsapp);
  if (normalizedWa.length < 10 || normalizedWa.length > 15) {
    res.status(400).json({ error: 'buyer_whatsapp tidak valid (contoh: 081234567890).' });
    return;
  }

  const activeAmounts = new Set(
    store.orders.filter((o) => o.status === 'PENDING').map((o) => o.totalAmount)
  );

  try {
    const channel = resolveActiveChannel(
      store.qrisChannels,
      requestedChannelId,
      store.settings.activeQrisChannelId
    );
    const uniqueCode = generateUniqueCode(activeAmounts, basePrice);
    const totalAmount = basePrice + uniqueCode;
    const dynamicQris = generateDynamicQris(channel.staticQris, totalAmount);

    const now = Date.now();
    const orderNumber = String(store.orders.length + 101).padStart(4, '0');
    const orderCode = `MP-${new Date(now).toISOString().slice(2, 10).replace(/-/g, '').slice(0, 4)}${orderNumber.slice(-2)}`;

    const order: OrderRecord = {
      id: `ord-${crypto.randomBytes(5).toString('hex')}`,
      orderCode,
      externalId,
      callbackUrl,
      returnUrl,
      fulfillmentMode,
      metadata,
      qrisChannelId: channel.id,
      qrisChannelLabel: channel.label,
      qrisProvider: channel.provider,
      productId: matchedProduct?.id ?? 'external-api',
      productName,
      buyerName,
      buyerEmail,
      buyerWhatsapp: normalizedWa,
      baseAmount: basePrice,
      uniqueCode,
      totalAmount,
      dynamicQris,
      status: 'PENDING',
      accessUrl,
      licenseKey: generateLicenseKey(licensePrefix, orderCode),
      matchedMutationId: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + store.settings.expiryMinutes * 60_000).toISOString(),
      paidAt: null,
      emailDelivery: {
        status: 'PENDING',
        recipient: buyerEmail,
        provider: getIntegrationStatus().emailProvider,
        messagePreview: '',
        sentAt: null,
      },
      whatsappDelivery: {
        status: 'PENDING',
        recipient: normalizedWa,
        provider: getIntegrationStatus().whatsappProvider,
        messagePreview: '',
        sentAt: null,
      },
    };

    store.orders.unshift(order);
    saveStore(store);

    const qrImageDataUrl = await QRCode.toDataURL(dynamicQris, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    });
    const paymentUrl = `${getBaseOrigin(req)}/?pay=${encodeURIComponent(order.orderCode)}`;

    dispatchOutboundEvent('payment.created', { ...order, payment_url: paymentUrl }, order.callbackUrl).then(() => {
      broadcastEvent('snapshot', getSnapshotPayload());
    });
    broadcastEvent('snapshot', getSnapshotPayload());

    res.status(201).json({
      payment: {
        id: order.id,
        order_code: order.orderCode,
        external_id: order.externalId,
        status: order.status,
        payment_url: paymentUrl,
        return_url: order.returnUrl ?? null,
        fulfillment_mode: order.fulfillmentMode ?? 'BOTH',
        metadata: order.metadata ?? null,
        qris_channel_id: channel.id,
        qris_channel_label: channel.label,
        qris_provider: channel.provider,
        merchant_name: channel.merchantName,
        base_amount: order.baseAmount,
        unique_code: order.uniqueCode,
        total_amount: order.totalAmount,
        qris_string: order.dynamicQris,
        expires_at: order.expiresAt,
        created_at: order.createdAt,
      },
      qr_image_data_url: qrImageDataUrl,
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Gagal membuat pembayaran QRIS.',
    });
  }
});

app.get('/api/v1/payments', requireExternalApiKey, (req: Request, res: Response) => {
  const store = loadStore();
  refreshExpiredOrders(store);
  const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : null;
  const externalIdFilter = req.query.external_id ? String(req.query.external_id) : null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const origin = getBaseOrigin(req);

  const items = store.orders
    .filter((o) => (!statusFilter || o.status === statusFilter))
    .filter((o) => (!externalIdFilter || o.externalId === externalIdFilter))
    .slice(0, limit)
    .map((o) => ({
      id: o.id,
      order_code: o.orderCode,
      external_id: o.externalId ?? null,
      status: o.status,
      payment_url: `${origin}/?pay=${encodeURIComponent(o.orderCode)}`,
      return_url: o.returnUrl ?? null,
      qris_channel_id: o.qrisChannelId ?? null,
      qris_channel_label: o.qrisChannelLabel ?? null,
      qris_provider: o.qrisProvider ?? null,
      product_name: o.productName,
      buyer_name: o.buyerName,
      buyer_email: o.buyerEmail,
      buyer_whatsapp: o.buyerWhatsapp,
      base_amount: o.baseAmount,
      unique_code: o.uniqueCode,
      total_amount: o.totalAmount,
      license_key: o.status === 'PAID' ? o.licenseKey : null,
      access_url: o.status === 'PAID' ? o.accessUrl : null,
      created_at: o.createdAt,
      expires_at: o.expiresAt,
      paid_at: o.paidAt,
    }));

  res.json({ count: items.length, payments: items });
});

app.get('/api/v1/payments/:idOrCode', requireExternalApiKey, (req: Request, res: Response) => {
  const store = loadStore();
  refreshExpiredOrders(store);
  const key = req.params.idOrCode;
  const order = store.orders.find(
    (o) => o.id === key || o.orderCode === key || (o.externalId && o.externalId === key)
  );
  if (!order) {
    res.status(404).json({ error: 'Pembayaran tidak ditemukan.' });
    return;
  }

  res.json({
    payment: {
      id: order.id,
      order_code: order.orderCode,
      external_id: order.externalId ?? null,
      status: order.status,
      payment_url: `${getBaseOrigin(req)}/?pay=${encodeURIComponent(order.orderCode)}`,
      return_url: order.returnUrl ?? null,
      fulfillment_mode: order.fulfillmentMode ?? 'BOTH',
      metadata: order.metadata ?? null,
      qris_channel_id: order.qrisChannelId ?? null,
      qris_channel_label: order.qrisChannelLabel ?? null,
      qris_provider: order.qrisProvider ?? null,
      product_name: order.productName,
      buyer_name: order.buyerName,
      buyer_email: order.buyerEmail,
      buyer_whatsapp: order.buyerWhatsapp,
      base_amount: order.baseAmount,
      unique_code: order.uniqueCode,
      total_amount: order.totalAmount,
      qris_string: order.dynamicQris,
      license_key: order.status === 'PAID' ? order.licenseKey : null,
      access_url: order.status === 'PAID' ? order.accessUrl : null,
      email_delivery_status: order.emailDelivery.status,
      whatsapp_delivery_status: order.whatsappDelivery.status,
      created_at: order.createdAt,
      expires_at: order.expiresAt,
      paid_at: order.paidAt,
    },
  });
});

app.get('/api/v1/mutations', requireExternalApiKey, (req: Request, res: Response) => {
  const store = loadStore();
  const statusFilter = req.query.status ? String(req.query.status).toUpperCase() : null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

  const items = store.mutations
    .filter((m) => (!statusFilter || m.status === statusFilter))
    .slice(0, limit)
    .map((m) => ({
      id: m.id,
      reference_id: m.referenceId,
      package_name: m.packageName,
      provider_name: m.providerName ?? detectProviderNameFromPackage(m.packageName),
      amount: m.amount,
      sender_name: m.senderName,
      status: m.status,
      matched_order_code: m.matchedOrderCode,
      raw_message: m.rawMessage,
      received_at: m.receivedAt,
    }));

  res.json({ count: items.length, mutations: items });
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MutasiPay] Server berjalan di http://0.0.0.0:${PORT}`);
  });
}

startServer();
