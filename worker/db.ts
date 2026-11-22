import type {
  DigitalProduct,
  MerchantSettings,
  MutationRecord,
  OrderRecord,
  OutboundWebhookEndpoint,
  OutboundWebhookLog,
  QrisChannel,
} from '../src/types';

export interface StoreData {
  qrisChannels: QrisChannel[];
  products: DigitalProduct[];
  orders: OrderRecord[];
  mutations: MutationRecord[];
  webhooks: OutboundWebhookEndpoint[];
  webhookLogs: OutboundWebhookLog[];
  settings: MerchantSettings;
}

export async function getStoreFromD1(db: D1Database): Promise<StoreData> {
  // 1. Refresh expired pending orders
  const nowIso = new Date().toISOString();
  await db
    .prepare("UPDATE orders SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at <= ?")
    .bind(nowIso)
    .run();

  // 2. Fetch all collections in parallel
  const [
    channelsRes,
    productsRes,
    ordersRes,
    mutationsRes,
    webhooksRes,
    logsRes,
    settingsRes,
  ] = await Promise.all([
    db.prepare('SELECT * FROM qris_channels ORDER BY created_at DESC').all(),
    db.prepare('SELECT * FROM products ORDER BY created_at DESC').all(),
    db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all(),
    db.prepare('SELECT * FROM mutations ORDER BY received_at DESC LIMIT 100').all(),
    db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all(),
    db.prepare('SELECT * FROM webhook_logs ORDER BY sent_at DESC LIMIT 100').all(),
    db.prepare('SELECT * FROM settings LIMIT 1').all(),
  ]);

  const qrisChannels: QrisChannel[] = (channelsRes.results || []).map((r: any) => ({
    id: String(r.id),
    label: String(r.label),
    provider: r.provider as any,
    providerName: String(r.provider_name),
    packageName: String(r.package_name),
    staticQris: String(r.static_qris),
    merchantName: String(r.merchant_name),
    merchantCity: String(r.merchant_city),
    postalCode: String(r.postal_code || ''),
    nmid: String(r.nmid || ''),
    acquirerDomain: String(r.acquirer_domain || ''),
    merchantPan: String(r.merchant_pan || ''),
    merchantCriteria: String(r.merchant_criteria || ''),
    mcc: String(r.mcc || ''),
    crc16: String(r.crc16 || ''),
    locked: true,
    createdAt: String(r.created_at),
  }));

  const products: DigitalProduct[] = (productsRes.results || []).map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    category: String(r.category),
    description: String(r.description || ''),
    price: Number(r.price),
    accessUrl: String(r.access_url),
    licensePrefix: String(r.license_prefix || 'DIGI'),
    fileInfo: String(r.file_info || ''),
    active: Boolean(r.active),
    createdAt: String(r.created_at),
  }));

  const orders: OrderRecord[] = (ordersRes.results || []).map((r: any) => {
    let emailDelivery: any = { status: 'PENDING', recipient: r.buyer_email, provider: 'preview', messagePreview: '', sentAt: null };
    let whatsappDelivery: any = { status: 'PENDING', recipient: r.buyer_whatsapp, provider: 'preview', messagePreview: '', sentAt: null };
    let metadata: any = null;

    try {
      if (r.email_delivery) emailDelivery = JSON.parse(r.email_delivery);
    } catch {}
    try {
      if (r.whatsapp_delivery) whatsappDelivery = JSON.parse(r.whatsapp_delivery);
    } catch {}
    try {
      if (r.metadata) metadata = JSON.parse(r.metadata);
    } catch {}

    return {
      id: String(r.id),
      orderCode: String(r.order_code),
      externalId: r.external_id ? String(r.external_id) : null,
      callbackUrl: r.callback_url ? String(r.callback_url) : null,
      returnUrl: r.return_url ? String(r.return_url) : null,
      fulfillmentMode: r.fulfillment_mode ? String(r.fulfillment_mode) as any : undefined,
      metadata,
      qrisChannelId: r.qris_channel_id ? String(r.qris_channel_id) : null,
      qrisChannelLabel: r.qris_channel_label ? String(r.qris_channel_label) : null,
      qrisProvider: r.qris_provider ? (r.qris_provider as any) : null,
      productId: String(r.product_id),
      productName: String(r.product_name),
      buyerName: String(r.buyer_name),
      buyerEmail: String(r.buyer_email),
      buyerWhatsapp: String(r.buyer_whatsapp),
      baseAmount: Number(r.base_amount),
      uniqueCode: Number(r.unique_code),
      totalAmount: Number(r.total_amount),
      dynamicQris: String(r.dynamic_qris),
      status: r.status as any,
      accessUrl: String(r.access_url),
      licenseKey: String(r.license_key),
      matchedMutationId: r.matched_mutation_id ? String(r.matched_mutation_id) : null,
      createdAt: String(r.created_at),
      expiresAt: String(r.expires_at),
      paidAt: r.paid_at ? String(r.paid_at) : null,
      emailDelivery,
      whatsappDelivery,
    };
  });

  const mutations: MutationRecord[] = (mutationsRes.results || []).map((r: any) => ({
    id: String(r.id),
    source: r.source as any,
    packageName: String(r.package_name),
    providerName: r.provider_name ? String(r.provider_name) : undefined,
    title: String(r.title),
    rawMessage: String(r.raw_message),
    amount: Number(r.amount),
    senderName: String(r.sender_name || ''),
    referenceId: String(r.reference_id || ''),
    status: r.status as any,
    matchedOrderId: r.matched_order_id ? String(r.matched_order_id) : null,
    matchedOrderCode: r.matched_order_code ? String(r.matched_order_code) : null,
    receivedAt: String(r.received_at),
  }));

  const webhooks: OutboundWebhookEndpoint[] = (webhooksRes.results || []).map((r: any) => {
    let events: any[] = [];
    try {
      events = JSON.parse(r.events);
    } catch {}
    return {
      id: String(r.id),
      name: String(r.name),
      url: String(r.url),
      events,
      active: Boolean(r.active),
      createdAt: String(r.created_at),
    };
  });

  const webhookLogs: OutboundWebhookLog[] = (logsRes.results || []).map((r: any) => ({
    id: String(r.id),
    deliveryId: String(r.delivery_id),
    endpointId: r.endpoint_id ? String(r.endpoint_id) : null,
    endpointName: String(r.endpoint_name),
    url: String(r.url),
    event: r.event as any,
    status: r.status as any,
    httpStatus: r.http_status !== null ? Number(r.http_status) : null,
    durationMs: Number(r.duration_ms || 0),
    payloadJson: String(r.payload_json),
    responseSnippet: String(r.response_snippet || ''),
    signatureHeader: String(r.signature_header || ''),
    sentAt: String(r.sent_at),
  }));

  const sRow: any = settingsRes.results?.[0] || {};
  const settings: MerchantSettings = {
    activeQrisChannelId: String(sRow.active_qris_channel_id || qrisChannels[0]?.id || 'qris_dana_default'),
    staticQris: String(sRow.static_qris || qrisChannels[0]?.staticQris || ''),
    expiryMinutes: Number(sRow.expiry_minutes || 30),
    autoFulfillEnabled: sRow.auto_fulfill_enabled !== undefined ? Boolean(sRow.auto_fulfill_enabled) : true,
    emailSubjectTemplate: String(sRow.email_subject_template || 'Akses Produk {{nama_produk}} — Pembayaran Terverifikasi ({{kode_pesanan}})'),
    emailBodyTemplate: String(sRow.email_body_template || 'Halo {{nama_pembeli}},\n\nPembayaran QRIS Anda sebesar {{nominal}} telah diverifikasi.'),
    whatsappTemplate: String(sRow.whatsapp_template || 'Halo {{nama_pembeli}}! Pembayaran QRIS Anda sebesar {{nominal}} telah diverifikasi.'),
  };

  return {
    qrisChannels,
    products,
    orders,
    mutations,
    webhooks,
    webhookLogs,
    settings,
  };
}

export async function insertOrderD1(db: D1Database, o: OrderRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (
        id, order_code, external_id, callback_url, return_url, fulfillment_mode, metadata,
        qris_channel_id, qris_channel_label, qris_provider, product_id, product_name,
        buyer_name, buyer_email, buyer_whatsapp, base_amount, unique_code, total_amount,
        dynamic_qris, status, access_url, license_key, matched_mutation_id,
        created_at, expires_at, paid_at, email_delivery, whatsapp_delivery
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      o.id,
      o.orderCode,
      o.externalId ?? null,
      o.callbackUrl ?? null,
      o.returnUrl ?? null,
      o.fulfillmentMode ?? null,
      o.metadata ? JSON.stringify(o.metadata) : null,
      o.qrisChannelId ?? null,
      o.qrisChannelLabel ?? null,
      o.qrisProvider ?? null,
      o.productId,
      o.productName,
      o.buyerName,
      o.buyerEmail,
      o.buyerWhatsapp,
      o.baseAmount,
      o.uniqueCode,
      o.totalAmount,
      o.dynamicQris,
      o.status,
      o.accessUrl,
      o.licenseKey,
      o.matchedMutationId ?? null,
      o.createdAt,
      o.expiresAt,
      o.paidAt ?? null,
      JSON.stringify(o.emailDelivery),
      JSON.stringify(o.whatsappDelivery)
    )
    .run();
}

export async function updateOrderPaidD1(
  db: D1Database,
  orderId: string,
  paidAt: string,
  mutationId: string,
  emailDelivery: any,
  whatsappDelivery: any
): Promise<void> {
  await db
    .prepare(
      `UPDATE orders SET
        status = 'PAID',
        paid_at = ?,
        matched_mutation_id = ?,
        email_delivery = ?,
        whatsapp_delivery = ?
      WHERE id = ?`
    )
    .bind(paidAt, mutationId, JSON.stringify(emailDelivery), JSON.stringify(whatsappDelivery), orderId)
    .run();
}

export async function insertMutationD1(db: D1Database, m: MutationRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mutations (
        id, source, package_name, provider_name, title, raw_message,
        amount, sender_name, reference_id, status, matched_order_id,
        matched_order_code, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      m.id,
      m.source,
      m.packageName,
      m.providerName ?? null,
      m.title,
      m.rawMessage,
      m.amount,
      m.senderName,
      m.referenceId,
      m.status,
      m.matchedOrderId ?? null,
      m.matchedOrderCode ?? null,
      m.receivedAt
    )
    .run();
}

export async function insertWebhookLogD1(db: D1Database, log: OutboundWebhookLog): Promise<void> {
  await db
    .prepare(
      `INSERT INTO webhook_logs (
        id, delivery_id, endpoint_id, endpoint_name, url, event, status,
        http_status, duration_ms, payload_json, response_snippet, signature_header, sent_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      log.id,
      log.deliveryId,
      log.endpointId ?? null,
      log.endpointName,
      log.url,
      log.event,
      log.status,
      log.httpStatus ?? null,
      log.durationMs,
      log.payloadJson,
      log.responseSnippet,
      log.signatureHeader,
      log.sentAt
    )
    .run();
}
