import { Hono } from 'hono';
import { cors } from 'hono/cors';
import QRCode from 'qrcode';
import { getStoreFromD1, insertMutationD1, insertOrderD1, updateOrderPaidD1 } from './db';
import { dispatchWorkerFulfillment, getWorkerIntegrationStatus, type FulfillmentEnv } from './fulfillment';
import { deliverWorkerWebhook, dispatchWorkerOutboundEvent } from './outboundWebhook';
import { generateDynamicQris, parseQrisMetadata } from '../src/lib/qris';
import {
  buildLockedQrisChannel,
  detectProviderNameFromPackage,
  resolveActiveChannel,
} from '../src/lib/qrisChannels';
import { parseDanaNotification } from '../src/lib/mutationParser';
import { isValidWebhookUrl, verifyWebhookSignature } from '../src/lib/webhookSigner';
import {
  generateLicenseKey,
  generateUniqueCode,
  matchMutationToOrder,
  normalizeWhatsappNumber,
} from '../src/lib/matcher';
import { buildOpenApiSpec } from '../server/openapi';
import type {
  DigitalProduct,
  MutationRecord,
  OrderRecord,
  OutboundWebhookEndpoint,
  QrisProvider,
  WebhookEventType,
} from '../src/types';

export interface Env extends FulfillmentEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_URL?: string;
  WEBHOOK_SECRET?: string;
  OUTBOUND_WEBHOOK_SECRET?: string;
  EXTERNAL_API_KEY?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for external applications
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Webhook-Secret'],
}));

function getBaseOrigin(c: any): string {
  const envUrl = c.env.APP_URL?.trim();
  if (envUrl && /^https?:\/\//i.test(envUrl) && !envUrl.includes('MY_APP_URL')) {
    return envUrl.replace(/\/+$/, '');
  }
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

async function renderQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 340,
    color: { dark: '#0F172A', light: '#FFFFFF' },
  });
}

// Full Dashboard Snapshot
app.get('/api/snapshot', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  return c.json({
    ...store,
    integration: {
      ...getWorkerIntegrationStatus(c.env),
      webhookSecretConfigured: Boolean(c.env.WEBHOOK_SECRET?.trim()),
      externalApiKeyConfigured: Boolean(c.env.EXTERNAL_API_KEY?.trim()),
      outboundSigningSecretConfigured: Boolean(c.env.OUTBOUND_WEBHOOK_SECRET?.trim()),
    },
  });
});

// SSE Events stream
app.get('/api/events', async (c) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Send initial connected event
  writer.write(encoder.encode(`event: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`));

  c.executionCtx.waitUntil(
    (async () => {
      try {
        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 20_000));
          await writer.write(encoder.encode(`event: ping\ndata: ${Date.now()}\n\n`));
        }
      } catch {
      } finally {
        try {
          await writer.close();
        } catch {}
      }
    })()
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// Render QR PNG
app.post('/api/qris/render', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const qris = String(body?.qris ?? '').trim();
  if (!qris) {
    return c.json({ error: 'String QRIS wajib diisi.' }, 400);
  }
  try {
    const dataUrl = await renderQrDataUrl(qris);
    return c.json({ dataUrl, metadata: parseQrisMetadata(qris) });
  } catch (err: any) {
    return c.json({ error: err?.message || 'Gagal membuat gambar QRIS.' }, 400);
  }
});

// ============================================================================
// MULTI-QRIS CHANNEL REGISTRY
// ============================================================================

app.get('/api/qris-channels', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  return c.json({
    channels: store.qrisChannels,
    activeQrisChannelId: store.settings.activeQrisChannelId,
  });
});

app.post('/api/qris-channels', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const label = String(body?.label ?? '').trim();
  const staticQris = String(body?.staticQris ?? '').trim();
  const provider = body?.provider ? (String(body.provider).trim() as QrisProvider) : undefined;
  const packageName = body?.packageName ? String(body.packageName).trim() : undefined;
  const setActive = Boolean(body?.setActive);

  try {
    const channel = buildLockedQrisChannel({
      id: `qris_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
      label,
      provider,
      packageName,
      staticQris,
      existingChannels: store.qrisChannels,
    });

    await c.env.DB.prepare(
      `INSERT INTO qris_channels (
        id, label, provider, provider_name, package_name, static_qris,
        merchant_name, merchant_city, postal_code, nmid, acquirer_domain,
        merchant_pan, merchant_criteria, mcc, crc16, locked, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
      .bind(
        channel.id, channel.label, channel.provider, channel.providerName, channel.packageName,
        channel.staticQris, channel.merchantName, channel.merchantCity, channel.postalCode,
        channel.nmid, channel.acquirerDomain, channel.merchantPan, channel.merchantCriteria,
        channel.mcc, channel.crc16, channel.createdAt
      )
      .run();

    if (setActive) {
      await c.env.DB.prepare(
        'UPDATE settings SET active_qris_channel_id = ?, static_qris = ? WHERE id = ?'
      )
        .bind(channel.id, channel.staticQris, 'default')
        .run();
    }

    return c.json({ channel, activeQrisChannelId: setActive ? channel.id : store.settings.activeQrisChannelId }, 201);
  } catch (err: any) {
    return c.json({ error: err?.message || 'Gagal menambahkan channel QRIS.' }, 400);
  }
});

app.post('/api/qris-channels/:id/activate', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const channel = store.qrisChannels.find((ch) => ch.id === c.req.param('id'));
  if (!channel) {
    return c.json({ error: 'Channel QRIS tidak ditemukan.' }, 404);
  }

  await c.env.DB.prepare(
    'UPDATE settings SET active_qris_channel_id = ?, static_qris = ? WHERE id = ?'
  )
    .bind(channel.id, channel.staticQris, 'default')
    .run();

  return c.json({ activeQrisChannelId: channel.id, channel });
});

app.delete('/api/qris-channels/:id', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  if (store.qrisChannels.length <= 1) {
    return c.json({ error: 'Minimal harus ada 1 channel QRIS aktif yang tersimpan.' }, 400);
  }

  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM qris_channels WHERE id = ?').bind(id).run();

  if (store.settings.activeQrisChannelId === id) {
    const fallback = store.qrisChannels.find((ch) => ch.id !== id) || store.qrisChannels[0];
    await c.env.DB.prepare(
      'UPDATE settings SET active_qris_channel_id = ?, static_qris = ? WHERE id = ?'
    )
      .bind(fallback.id, fallback.staticQris, 'default')
      .run();
  }

  return c.json({ deleted: true });
});

// ============================================================================
// PRODUCTS CRUD
// ============================================================================

app.post('/api/products', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim();
  const category = String(body?.category ?? 'Produk Digital').trim();
  const description = String(body?.description ?? '').trim();
  const price = Math.round(Number(body?.price ?? 0));
  const accessUrl = String(body?.accessUrl ?? '').trim();
  const licensePrefix = String(body?.licensePrefix ?? 'DIGI').trim().toUpperCase().slice(0, 6);
  const fileInfo = String(body?.fileInfo ?? 'Akses Instan').trim();

  if (!name || name.length < 3) return c.json({ error: 'Nama produk minimal 3 karakter.' }, 400);
  if (!Number.isFinite(price) || price < 1000) return c.json({ error: 'Harga produk minimal Rp 1.000.' }, 400);
  if (!accessUrl || !/^https?:\/\//i.test(accessUrl)) {
    return c.json({ error: 'Link akses produk harus diawali https:// atau http://.' }, 400);
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  const product: DigitalProduct = {
    id: `prod-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
    name,
    slug: `${slug || 'produk'}-${crypto.randomUUID().slice(0, 4)}`,
    category: category || 'Produk Digital',
    description: description || 'Produk digital dengan pengiriman akses otomatis setelah pembayaran QRIS.',
    price,
    accessUrl,
    licensePrefix: licensePrefix || 'DIGI',
    fileInfo: fileInfo || 'Akses Instan',
    active: true,
    createdAt: new Date().toISOString(),
  };

  await c.env.DB.prepare(
    `INSERT INTO products (id, name, slug, category, description, price, access_url, license_prefix, file_info, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  )
    .bind(
      product.id, product.name, product.slug, product.category, product.description,
      product.price, product.accessUrl, product.licensePrefix, product.fileInfo, product.createdAt
    )
    .run();

  return c.json(product, 201);
});

app.put('/api/products/:id', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const existing = store.products.find((p) => p.id === c.req.param('id'));
  if (!existing) return c.json({ error: 'Produk tidak ditemukan.' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const name = body?.name !== undefined ? String(body.name).trim() : existing.name;
  const price = body?.price !== undefined ? Math.round(Number(body.price)) : existing.price;
  const accessUrl = body?.accessUrl !== undefined ? String(body.accessUrl).trim() : existing.accessUrl;

  if (!name || name.length < 3) return c.json({ error: 'Nama produk minimal 3 karakter.' }, 400);
  if (!Number.isFinite(price) || price < 1000) return c.json({ error: 'Harga produk minimal Rp 1.000.' }, 400);
  if (!accessUrl || !/^https?:\/\//i.test(accessUrl)) {
    return c.json({ error: 'Link akses produk harus berupa URL yang valid.' }, 400);
  }

  const updated: DigitalProduct = {
    ...existing,
    name,
    category: body?.category !== undefined ? String(body.category).trim() : existing.category,
    description: body?.description !== undefined ? String(body.description).trim() : existing.description,
    price,
    accessUrl,
    licensePrefix: body?.licensePrefix !== undefined ? String(body.licensePrefix).trim().toUpperCase().slice(0, 6) : existing.licensePrefix,
    fileInfo: body?.fileInfo !== undefined ? String(body.fileInfo).trim() : existing.fileInfo,
    active: body?.active !== undefined ? Boolean(body.active) : existing.active,
  };

  await c.env.DB.prepare(
    `UPDATE products SET name = ?, category = ?, description = ?, price = ?, access_url = ?, license_prefix = ?, file_info = ?, active = ? WHERE id = ?`
  )
    .bind(
      updated.name, updated.category, updated.description, updated.price,
      updated.accessUrl, updated.licensePrefix, updated.fileInfo, updated.active ? 1 : 0, updated.id
    )
    .run();

  return c.json(updated);
});

app.delete('/api/products/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ deleted: true });
});

// ============================================================================
// ORDERS & PAYMENTS CREATION
// ============================================================================

app.post('/api/orders', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const productId = String(body?.productId ?? '').trim();
  const buyerName = String(body?.buyerName ?? '').trim();
  const buyerEmail = String(body?.buyerEmail ?? '').trim();
  const rawWhatsapp = String(body?.buyerWhatsapp ?? '').trim();
  const requestedChannelId = body?.qrisChannelId ? String(body.qrisChannelId).trim() : null;
  const returnUrl = body?.returnUrl ? String(body.returnUrl).trim() : null;

  const product = store.products.find((p) => p.id === productId);
  if (!product) return c.json({ error: 'Produk digital tidak ditemukan.' }, 404);
  if (!buyerName || buyerName.length < 2) return c.json({ error: 'Nama pembeli wajib diisi.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) return c.json({ error: 'Email tidak valid.' }, 400);
  const normalizedWa = normalizeWhatsappNumber(rawWhatsapp);
  if (normalizedWa.length < 10 || normalizedWa.length > 15) {
    return c.json({ error: 'Nomor WhatsApp tidak valid.' }, 400);
  }

  const activeAmounts = new Set(
    store.orders.filter((o) => o.status === 'PENDING').map((o) => o.totalAmount)
  );

  const channel = resolveActiveChannel(store.qrisChannels, requestedChannelId, store.settings.activeQrisChannelId);
  const uniqueCode = generateUniqueCode(activeAmounts, product.price);
  const totalAmount = product.price + uniqueCode;
  const dynamicQris = generateDynamicQris(channel.staticQris, totalAmount);

  const now = Date.now();
  const orderNumber = String(store.orders.length + 101).padStart(4, '0');
  const orderCode = `MP-${new Date(now).toISOString().slice(2, 10).replace(/-/g, '').slice(0, 4)}${orderNumber.slice(-2)}`;

  const order: OrderRecord = {
    id: `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
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
      provider: getWorkerIntegrationStatus(c.env).emailProvider,
      messagePreview: '',
      sentAt: null,
    },
    whatsappDelivery: {
      status: 'PENDING',
      recipient: normalizedWa,
      provider: getWorkerIntegrationStatus(c.env).whatsappProvider,
      messagePreview: '',
      sentAt: null,
    },
  };

  await insertOrderD1(c.env.DB, order);
  const qrDataUrl = await renderQrDataUrl(dynamicQris);
  const paymentUrl = `${getBaseOrigin(c)}/?pay=${encodeURIComponent(order.orderCode)}`;

  c.executionCtx.waitUntil(
    dispatchWorkerOutboundEvent(
      c.env.DB,
      store.webhooks,
      'payment.created',
      { ...order, payment_url: paymentUrl },
      c.env.OUTBOUND_WEBHOOK_SECRET,
      order.callbackUrl
    )
  );

  return c.json({ order, qrDataUrl, paymentUrl, channel }, 201);
});

app.get('/api/orders/:id', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const order = store.orders.find((o) => o.id === c.req.param('id'));
  if (!order) return c.json({ error: 'Pesanan tidak ditemukan.' }, 404);
  const qrDataUrl = await renderQrDataUrl(order.dynamicQris);
  return c.json({ order, qrDataUrl });
});

// Public Hosted Checkout Page Lookup
app.get('/api/pay/:codeOrId', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const key = c.req.param('codeOrId');
  const order = store.orders.find(
    (o) => o.orderCode === key || o.id === key || (o.externalId && o.externalId === key)
  );
  if (!order) return c.json({ error: 'Halaman pembayaran tidak ditemukan.' }, 404);

  const channel = resolveActiveChannel(store.qrisChannels, order.qrisChannelId, store.settings.activeQrisChannelId);
  const qrMeta = parseQrisMetadata(order.dynamicQris);
  const qrDataUrl = await renderQrDataUrl(order.dynamicQris);

  return c.json({
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
      emailDeliveryStatus: order.emailDelivery?.status,
      whatsappDeliveryStatus: order.whatsappDelivery?.status,
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

// Resend fulfillment
app.post('/api/orders/:id/resend', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const order = store.orders.find((o) => o.id === c.req.param('id'));
  if (!order) return c.json({ error: 'Pesanan tidak ditemukan.' }, 404);
  if (order.status !== 'PAID') return c.json({ error: 'Pesanan belum terverifikasi lunas.' }, 400);

  const fulfillment = await dispatchWorkerFulfillment(order, store.settings, c.env);
  await c.env.DB.prepare(
    'UPDATE orders SET email_delivery = ?, whatsapp_delivery = ? WHERE id = ?'
  )
    .bind(JSON.stringify(fulfillment.emailDelivery), JSON.stringify(fulfillment.whatsappDelivery), order.id)
    .run();

  order.emailDelivery = fulfillment.emailDelivery;
  order.whatsappDelivery = fulfillment.whatsappDelivery;
  return c.json({ order });
});

// Update Settings
app.put('/api/settings', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const activeChannel = resolveActiveChannel(store.qrisChannels, null, store.settings.activeQrisChannelId);

  const expiryMinutes = body?.expiryMinutes !== undefined ? Math.max(5, Math.min(180, Number(body.expiryMinutes))) : store.settings.expiryMinutes;
  const autoFulfill = body?.autoFulfillEnabled !== undefined ? Boolean(body.autoFulfillEnabled) : store.settings.autoFulfillEnabled;
  const emailSubject = body?.emailSubjectTemplate !== undefined ? String(body.emailSubjectTemplate) : store.settings.emailSubjectTemplate;
  const emailBody = body?.emailBodyTemplate !== undefined ? String(body.emailBodyTemplate) : store.settings.emailBodyTemplate;
  const waTemplate = body?.whatsappTemplate !== undefined ? String(body.whatsappTemplate) : store.settings.whatsappTemplate;

  await c.env.DB.prepare(
    `UPDATE settings SET
      active_qris_channel_id = ?, static_qris = ?, expiry_minutes = ?,
      auto_fulfill_enabled = ?, email_subject_template = ?,
      email_body_template = ?, whatsapp_template = ?
     WHERE id = ?`
  )
    .bind(
      activeChannel.id, activeChannel.staticQris, expiryMinutes,
      autoFulfill ? 1 : 0, emailSubject, emailBody, waTemplate, 'default'
    )
    .run();

  return c.json({
    activeQrisChannelId: activeChannel.id,
    staticQris: activeChannel.staticQris,
    expiryMinutes,
    autoFulfillEnabled: autoFulfill,
    emailSubjectTemplate: emailSubject,
    emailBodyTemplate: emailBody,
    whatsappTemplate: waTemplate,
  });
});

// ============================================================================
// INCOMING MUTATION WEBHOOK (DANA, NEOBANK, ETC.)
// ============================================================================

async function processMutation(c: any, source: 'DANA_WEBHOOK' | 'MANUAL_SIMULATION') {
  const store = await getStoreFromD1(c.env.DB);
  const body = await c.req.json().catch(() => ({}));

  const title = String(body?.title ?? 'DANA Bisnis — Pembayaran QRIS').trim();
  const message = String(body?.message ?? body?.text ?? '').trim();
  const packageName = String(body?.packageName ?? body?.package_name ?? 'id.dana.merchant').trim();
  const explicitAmount = body?.amount !== undefined && body?.amount !== '' ? Number(body.amount) : undefined;
  const senderName = body?.senderName ? String(body.senderName) : undefined;
  const referenceId = body?.referenceId ? String(body.referenceId) : undefined;

  const parsed = parseDanaNotification({
    title,
    message: message || `Kamu baru saja menerima pembayaran Rp ${new Intl.NumberFormat('id-ID').format(explicitAmount || 0)} melalui QRIS${senderName ? ` dari ${senderName}` : ''}`,
    packageName,
    amount: explicitAmount,
    senderName,
    referenceId,
  });

  if (!parsed) {
    return c.json({ error: 'Notifikasi tidak dikenali sebagai pembayaran masuk QRIS.' }, 422);
  }

  const matchedOrder = matchMutationToOrder(parsed.amount, store.orders, Date.now());
  const mutation: MutationRecord = {
    id: `mut-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
    source,
    packageName,
    providerName: detectProviderNameFromPackage(packageName),
    title,
    rawMessage: message || `Kamu baru saja menerima pembayaran Rp ${new Intl.NumberFormat('id-ID').format(parsed.amount)} melalui QRIS dari ${parsed.senderName}`,
    amount: parsed.amount,
    senderName: parsed.senderName,
    referenceId: parsed.referenceId,
    status: matchedOrder ? 'MATCHED' : 'UNMATCHED',
    matchedOrderId: matchedOrder?.id ?? null,
    matchedOrderCode: matchedOrder?.orderCode ?? null,
    receivedAt: new Date().toISOString(),
  };

  await insertMutationD1(c.env.DB, mutation);

  if (matchedOrder) {
    let emailLog = matchedOrder.emailDelivery;
    let waLog = matchedOrder.whatsappDelivery;
    if (store.settings.autoFulfillEnabled) {
      const f = await dispatchWorkerFulfillment(matchedOrder, store.settings, c.env);
      emailLog = f.emailDelivery;
      waLog = f.whatsappDelivery;
    }
    await updateOrderPaidD1(c.env.DB, matchedOrder.id, mutation.receivedAt, mutation.id, emailLog, waLog);
    matchedOrder.status = 'PAID';
    matchedOrder.paidAt = mutation.receivedAt;

    c.executionCtx.waitUntil(
      dispatchWorkerOutboundEvent(
        c.env.DB,
        store.webhooks,
        'payment.paid',
        {
          order_id: matchedOrder.id,
          order_code: matchedOrder.orderCode,
          external_id: matchedOrder.externalId ?? null,
          qris_channel_id: matchedOrder.qrisChannelId ?? null,
          qris_channel_label: matchedOrder.qrisChannelLabel ?? null,
          qris_provider: matchedOrder.qrisProvider ?? null,
          status: 'PAID',
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
        c.env.OUTBOUND_WEBHOOK_SECRET,
        matchedOrder.callbackUrl
      )
    );
  }

  c.executionCtx.waitUntil(
    dispatchWorkerOutboundEvent(
      c.env.DB,
      store.webhooks,
      'mutation.received',
      mutation,
      c.env.OUTBOUND_WEBHOOK_SECRET
    )
  );

  return c.json({ mutation, matchedOrder }, 201);
}

app.post('/api/webhook/dana', async (c) => {
  const secret = c.env.WEBHOOK_SECRET?.trim();
  if (secret) {
    const provided = c.req.header('x-webhook-secret') || c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (provided !== secret) return c.json({ error: 'Header X-Webhook-Secret tidak valid.' }, 401);
  }
  return processMutation(c, 'DANA_WEBHOOK');
});

app.post('/api/simulate/dana-webhook', async (c) => {
  return processMutation(c, 'MANUAL_SIMULATION');
});

app.post('/api/v1/webhooks/mutation', async (c) => {
  const secret = c.env.WEBHOOK_SECRET?.trim();
  if (secret) {
    const provided = c.req.header('x-webhook-secret') || c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (provided !== secret) return c.json({ error: 'Header X-Webhook-Secret tidak valid.' }, 401);
  }
  return processMutation(c, 'DANA_WEBHOOK');
});

app.post('/api/v1/webhooks/dana', async (c) => {
  return c.redirect('/api/v1/webhooks/mutation', 307);
});

// Manual Match fallback
app.post('/api/mutations/:mutationId/match/:orderId', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const mutationId = c.req.param('mutationId');
  const orderId = c.req.param('orderId');
  const mutation = store.mutations.find((m) => m.id === mutationId);
  const order = store.orders.find((o) => o.id === orderId);

  if (!mutation || !order) return c.json({ error: 'Mutasi atau pesanan tidak ditemukan.' }, 404);

  const fulfillment = await dispatchWorkerFulfillment(order, store.settings, c.env);
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    'UPDATE mutations SET status = ?, matched_order_id = ?, matched_order_code = ? WHERE id = ?'
  )
    .bind('MATCHED', order.id, order.orderCode, mutation.id)
    .run();

  await updateOrderPaidD1(c.env.DB, order.id, now, mutation.id, fulfillment.emailDelivery, fulfillment.whatsappDelivery);

  return c.json({ mutation, order });
});

// ============================================================================
// OUTBOUND WEBHOOK MANAGEMENT
// ============================================================================

app.get('/api/webhooks', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  return c.json({ webhooks: store.webhooks, logs: store.webhookLogs });
});

app.post('/api/webhooks', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim();
  const url = String(body?.url ?? '').trim();
  const events = Array.isArray(body?.events) ? body.events : [];

  if (!name || name.length < 2) return c.json({ error: 'Nama webhook minimal 2 karakter.' }, 400);
  if (!isValidWebhookUrl(url)) return c.json({ error: 'URL Webhook tidak valid.' }, 400);
  if (events.length === 0) return c.json({ error: 'Pilih minimal satu event webhook.' }, 400);

  const endpoint: OutboundWebhookEndpoint = {
    id: `wh_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`,
    name,
    url,
    events,
    active: true,
    createdAt: new Date().toISOString(),
  };

  await c.env.DB.prepare(
    'INSERT INTO webhooks (id, name, url, events, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  )
    .bind(endpoint.id, endpoint.name, endpoint.url, JSON.stringify(endpoint.events), endpoint.createdAt)
    .run();

  return c.json(endpoint, 201);
});

app.patch('/api/webhooks/:id', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const ep = store.webhooks.find((w) => w.id === c.req.param('id'));
  if (!ep) return c.json({ error: 'Endpoint webhook tidak ditemukan.' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const name = body?.name !== undefined ? String(body.name).trim() : ep.name;
  const url = body?.url !== undefined ? String(body.url).trim() : ep.url;
  const active = body?.active !== undefined ? Boolean(body.active) : ep.active;
  const events = Array.isArray(body?.events) ? body.events : ep.events;

  await c.env.DB.prepare(
    'UPDATE webhooks SET name = ?, url = ?, events = ?, active = ? WHERE id = ?'
  )
    .bind(name, url, JSON.stringify(events), active ? 1 : 0, ep.id)
    .run();

  return c.json({ ...ep, name, url, active, events });
});

app.delete('/api/webhooks/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM webhooks WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ deleted: true });
});

app.post('/api/webhooks/:id/ping', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const ep = store.webhooks.find((w) => w.id === c.req.param('id'));
  if (!ep) return c.json({ error: 'Endpoint webhook tidak ditemukan.' }, 404);

  const log = await deliverWorkerWebhook({
    db: c.env.DB,
    endpointId: ep.id,
    endpointName: ep.name,
    url: ep.url,
    event: 'webhook.ping',
    data: {
      message: 'Ping verifikasi koneksi webhook MutasiPay Cloudflare Worker.',
      endpoint_id: ep.id,
      subscribed_events: ep.events,
    },
    secret: c.env.OUTBOUND_WEBHOOK_SECRET,
  });

  return c.json({ log });
});

app.post('/api/webhook-logs/:logId/retry', async (c) => {
  const store = await getStoreFromD1(c.env.DB);
  const original = store.webhookLogs.find((l) => l.id === c.req.param('logId'));
  if (!original) return c.json({ error: 'Riwayat log webhook tidak ditemukan.' }, 404);

  let parsedData: any = {};
  try {
    const envelope = JSON.parse(original.payloadJson);
    parsedData = envelope.data ?? envelope;
  } catch {
    parsedData = { raw: original.payloadJson };
  }

  const log = await deliverWorkerWebhook({
    db: c.env.DB,
    endpointId: original.endpointId,
    endpointName: original.endpointName,
    url: original.url,
    event: original.event,
    data: parsedData,
    secret: c.env.OUTBOUND_WEBHOOK_SECRET,
  });

  return c.json({ log });
});

// ============================================================================
// PUBLIC EXTERNAL REST API v1 (/api/v1/*)
// ============================================================================

function checkApiKey(c: any): boolean {
  const key = c.env.EXTERNAL_API_KEY?.trim();
  if (!key) return true;
  const provided = c.req.header('x-api-key')?.trim() || c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
  return provided === key;
}

app.get('/api/v1/openapi.json', (c) => {
  return c.json(buildOpenApiSpec(getBaseOrigin(c)));
});

app.post('/api/v1/webhook-echo', async (c) => {
  const timestamp = c.req.header('x-mutasipay-timestamp') || '';
  const signature = c.req.header('x-mutasipay-signature') || '';
  const event = c.req.header('x-mutasipay-event') || 'unknown';
  const deliveryId = c.req.header('x-mutasipay-delivery') || '';
  const rawBody = await c.req.text();
  const signatureValid = verifyWebhookSignature(
    rawBody,
    timestamp,
    signature,
    c.env.OUTBOUND_WEBHOOK_SECRET || 'mutasipay-webhook-signing-secret'
  );

  return c.json({
    ok: true,
    received_at: new Date().toISOString(),
    event,
    delivery_id: deliveryId,
    signature_valid: signatureValid,
  });
});

app.get('/api/v1/health', async (c) => {
  if (!checkApiKey(c)) return c.json({ error: 'Unauthorized: API Key tidak valid.' }, 401);
  const store = await getStoreFromD1(c.env.DB);
  const activeChannel = resolveActiveChannel(store.qrisChannels, null, store.settings.activeQrisChannelId);
  const meta = parseQrisMetadata(activeChannel.staticQris);

  return c.json({
    status: 'ok',
    service: 'MutasiPay Multi-QRIS Payment Gateway (Cloudflare Edge Worker)',
    version: '1.1.0',
    channels_count: store.qrisChannels.length,
    active_channel: {
      id: activeChannel.id,
      label: activeChannel.label,
      provider: activeChannel.provider,
      provider_name: activeChannel.providerName,
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

app.get('/api/v1/channels', async (c) => {
  if (!checkApiKey(c)) return c.json({ error: 'Unauthorized: API Key tidak valid.' }, 401);
  const store = await getStoreFromD1(c.env.DB);
  return c.json({
    active_channel_id: store.settings.activeQrisChannelId,
    count: store.qrisChannels.length,
    channels: store.qrisChannels,
  });
});

app.get('/api/v1/products', async (c) => {
  if (!checkApiKey(c)) return c.json({ error: 'Unauthorized: API Key tidak valid.' }, 401);
  const store = await getStoreFromD1(c.env.DB);
  return c.json({
    products: store.products.filter((p) => p.active),
  });
});

app.post('/api/v1/qris/dynamic', async (c) => {
  if (!checkApiKey(c)) return c.json({ error: 'Unauthorized: API Key tidak valid.' }, 401);
  const store = await getStoreFromD1(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const directAmount = body?.amount !== undefined ? Math.round(Number(body.amount)) : null;
  const baseAmount = body?.base_amount !== undefined ? Math.round(Number(body.base_amount)) : null;
  const withUniqueCode = Boolean(body?.with_unique_code);
  const requestedChannelId = body?.qris_channel_id ? String(body.qris_channel_id).trim() : null;

  let finalAmount = directAmount ?? baseAmount ?? 0;
  let uniqueCode = 0;

  if (!Number.isFinite(finalAmount) || finalAmount < 100) {
    return c.json({ error: 'Parameter amount atau base_amount minimal Rp 100.' }, 400);
  }

  const channel = resolveActiveChannel(store.qrisChannels, requestedChannelId, store.settings.activeQrisChannelId);
  if (withUniqueCode && baseAmount !== null) {
    const activeAmounts = new Set(
      store.orders.filter((o) => o.status === 'PENDING').map((o) => o.totalAmount)
    );
    uniqueCode = generateUniqueCode(activeAmounts, baseAmount);
    finalAmount = baseAmount + uniqueCode;
  }

  const qrisString = generateDynamicQris(channel.staticQris, finalAmount);
  const meta = parseQrisMetadata(qrisString);
  const qrImageDataUrl = await renderQrDataUrl(qrisString);

  return c.json({
    amount: finalAmount,
    base_amount: baseAmount ?? finalAmount,
    unique_code: uniqueCode,
    qris_string: qrisString,
    qr_image_data_url: qrImageDataUrl,
    crc16: meta.crcProvided,
    channel: { id: channel.id, label: channel.label, provider: channel.provider },
    merchant: { name: meta.merchantName, city: meta.merchantCity, nmid: meta.nmid },
  });
});

app.post('/api/v1/payments', async (c) => {
  if (!checkApiKey(c)) return c.json({ error: 'Unauthorized: API Key tidak valid.' }, 401);
  const store = await getStoreFromD1(c.env.DB);
  const body = await c.req.json().catch(() => ({}));

  const productId = String(body?.product_id ?? '').trim();
  const externalId = body?.external_id ? String(body.external_id).trim() : null;
  const callbackUrl = body?.callback_url ? String(body.callback_url).trim() : null;
  const returnUrl = body?.return_url ? String(body.return_url).trim() : null;
  const requestedChannelId = body?.qris_channel_id ? String(body.qris_channel_id).trim() : null;
  const buyerName = String(body?.buyer_name ?? '').trim();
  const buyerEmail = String(body?.buyer_email ?? '').trim();
  const rawWhatsapp = String(body?.buyer_whatsapp ?? '').trim();

  if (callbackUrl && !isValidWebhookUrl(callbackUrl)) {
    return c.json({ error: 'callback_url harus berupa URL yang valid.' }, 400);
  }

  const matchedProduct = productId ? store.products.find((p) => p.id === productId) : undefined;
  const productName = matchedProduct?.name || String(body?.product_name ?? '').trim() || 'Pembayaran Produk Digital';
  const basePrice = matchedProduct?.price ?? Math.round(Number(body?.amount ?? 0));
  const accessUrl = String(body?.access_url ?? '').trim() || matchedProduct?.accessUrl || 'https://akses.ayampetokdigital.id/order';
  const licensePrefix = matchedProduct?.licensePrefix || 'EXT';

  if (!Number.isFinite(basePrice) || basePrice < 1000) {
    return c.json({ error: 'Nominal pembayaran minimal Rp 1.000.' }, 400);
  }
  if (!buyerName || buyerName.length < 2) return c.json({ error: 'buyer_name wajib diisi.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) return c.json({ error: 'buyer_email tidak valid.' }, 400);
  const normalizedWa = normalizeWhatsappNumber(rawWhatsapp);
  if (normalizedWa.length < 10 || normalizedWa.length > 15) {
    return c.json({ error: 'buyer_whatsapp tidak valid.' }, 400);
  }

  const activeAmounts = new Set(
    store.orders.filter((o) => o.status === 'PENDING').map((o) => o.totalAmount)
  );
  const channel = resolveActiveChannel(store.qrisChannels, requestedChannelId, store.settings.activeQrisChannelId);
  const uniqueCode = generateUniqueCode(activeAmounts, basePrice);
  const totalAmount = basePrice + uniqueCode;
  const dynamicQris = generateDynamicQris(channel.staticQris, totalAmount);

  const now = Date.now();
  const orderNumber = String(store.orders.length + 101).padStart(4, '0');
  const orderCode = `MP-${new Date(now).toISOString().slice(2, 10).replace(/-/g, '').slice(0, 4)}${orderNumber.slice(-2)}`;

  const order: OrderRecord = {
    id: `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
    orderCode,
    externalId,
    callbackUrl,
    returnUrl,
    fulfillmentMode: body?.fulfillment_mode,
    metadata: body?.metadata,
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
      provider: getWorkerIntegrationStatus(c.env).emailProvider,
      messagePreview: '',
      sentAt: null,
    },
    whatsappDelivery: {
      status: 'PENDING',
      recipient: normalizedWa,
      provider: getWorkerIntegrationStatus(c.env).whatsappProvider,
      messagePreview: '',
      sentAt: null,
    },
  };

  await insertOrderD1(c.env.DB, order);
  const qrImageDataUrl = await renderQrDataUrl(dynamicQris);
  const paymentUrl = `${getBaseOrigin(c)}/?pay=${encodeURIComponent(order.orderCode)}`;

  c.executionCtx.waitUntil(
    dispatchWorkerOutboundEvent(
      c.env.DB,
      store.webhooks,
      'payment.created',
      { ...order, payment_url: paymentUrl },
      c.env.OUTBOUND_WEBHOOK_SECRET,
      order.callbackUrl
    )
  );

  return c.json({
    payment: {
      id: order.id,
      order_code: order.orderCode,
      external_id: order.externalId,
      status: order.status,
      payment_url: paymentUrl,
      return_url: order.returnUrl ?? null,
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
  }, 201);
});

app.get('/api/v1/payments', async (c) => {
  if (!checkApiKey(c)) return c.json({ error: 'Unauthorized: API Key tidak valid.' }, 401);
  const store = await getStoreFromD1(c.env.DB);
  const statusFilter = c.req.query('status')?.toUpperCase();
  const externalIdFilter = c.req.query('external_id');
  const origin = getBaseOrigin(c);

  const items = store.orders
    .filter((o) => (!statusFilter || o.status === statusFilter))
    .filter((o) => (!externalIdFilter || o.externalId === externalIdFilter))
    .map((o) => ({
      id: o.id,
      order_code: o.orderCode,
      external_id: o.externalId ?? null,
      status: o.status,
      payment_url: `${origin}/?pay=${encodeURIComponent(o.orderCode)}`,
      return_url: o.returnUrl ?? null,
      total_amount: o.totalAmount,
      license_key: o.status === 'PAID' ? o.licenseKey : null,
      access_url: o.status === 'PAID' ? o.accessUrl : null,
      paid_at: o.paidAt,
      created_at: o.createdAt,
    }));

  return c.json({ count: items.length, payments: items });
});

app.get('/api/v1/payments/:idOrCode', async (c) => {
  if (!checkApiKey(c)) return c.json({ error: 'Unauthorized: API Key tidak valid.' }, 401);
  const store = await getStoreFromD1(c.env.DB);
  const key = c.req.param('idOrCode');
  const order = store.orders.find(
    (o) => o.id === key || o.orderCode === key || (o.externalId && o.externalId === key)
  );
  if (!order) return c.json({ error: 'Pembayaran tidak ditemukan.' }, 404);

  return c.json({
    payment: {
      id: order.id,
      order_code: order.orderCode,
      external_id: order.externalId ?? null,
      status: order.status,
      payment_url: `${getBaseOrigin(c)}/?pay=${encodeURIComponent(order.orderCode)}`,
      return_url: order.returnUrl ?? null,
      buyer_name: order.buyerName,
      buyer_email: order.buyerEmail,
      buyer_whatsapp: order.buyerWhatsapp,
      total_amount: order.totalAmount,
      license_key: order.status === 'PAID' ? order.licenseKey : null,
      access_url: order.status === 'PAID' ? order.accessUrl : null,
      paid_at: order.paidAt,
      created_at: order.createdAt,
    },
  });
});

app.get('/api/v1/mutations', async (c) => {
  if (!checkApiKey(c)) return c.json({ error: 'Unauthorized: API Key tidak valid.' }, 401);
  const store = await getStoreFromD1(c.env.DB);
  return c.json({ count: store.mutations.length, mutations: store.mutations });
});

// Serve Frontend Static Assets fallback
app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
