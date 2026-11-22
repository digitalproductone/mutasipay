import type { DeliveryChannelLog, MerchantSettings, MutationRecord, OrderRecord } from '../src/types';
import { formatRupiah, parseQrisMetadata } from '../src/lib/qris';
import { renderFulfillmentTemplate } from '../src/lib/matcher';
import { normalizePhone } from './auth';

export interface FulfillmentEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  WA_GATEWAY_URL?: string;
  WA_API_TOKEN?: string;
  WA_PROVIDER?: string;
  STARSENDER_BASE_URL?: string;
  STARSENDER_API_KEY?: string;
  OWNER_WHATSAPP?: string;
}

export function getWorkerIntegrationStatus(env: FulfillmentEnv) {
  const hasResend = Boolean(env.RESEND_API_KEY?.trim());
  const hasStarsender = Boolean(env.STARSENDER_API_KEY?.trim());
  const hasWaGateway = Boolean(env.WA_GATEWAY_URL?.trim() && env.WA_API_TOKEN?.trim());
  const whatsappConfigured = hasStarsender || hasWaGateway;

  return {
    webhookSecretConfigured: true,
    externalApiKeyConfigured: false,
    outboundSigningSecretConfigured: true,
    emailProvider: hasResend ? 'resend' : 'preview',
    emailConfigured: hasResend,
    whatsappProvider: hasStarsender ? 'starsender' : (env.WA_PROVIDER?.trim() || (hasWaGateway ? 'webhook' : 'preview')),
    whatsappConfigured,
  };
}

export async function dispatchWorkerFulfillment(
  order: OrderRecord,
  settings: MerchantSettings,
  env: FulfillmentEnv
): Promise<{
  emailDelivery: DeliveryChannelLog;
  whatsappDelivery: DeliveryChannelLog;
}> {
  const qrisMeta = parseQrisMetadata(settings.staticQris);
  const vars = {
    nama_pembeli: order.buyerName,
    nama_produk: order.productName,
    nominal: formatRupiah(order.totalAmount),
    kode_pesanan: order.orderCode,
    link_akses: order.accessUrl,
    kunci_lisensi: order.licenseKey,
    merchant: qrisMeta.merchantName,
  };

  const emailSubject = renderFulfillmentTemplate(settings.emailSubjectTemplate, vars);
  const emailBody = renderFulfillmentTemplate(settings.emailBodyTemplate, vars);
  const whatsappText = renderFulfillmentTemplate(settings.whatsappTemplate, vars);

  const [emailDelivery, whatsappDelivery] = await Promise.all([
    sendWorkerEmail(order.buyerEmail, emailSubject, emailBody, env),
    sendWorkerWhatsapp(order.buyerWhatsapp, whatsappText, env),
  ]);

  return { emailDelivery, whatsappDelivery };
}

async function sendWorkerEmail(
  to: string,
  subject: string,
  textBody: string,
  env: FulfillmentEnv
): Promise<DeliveryChannelLog> {
  const nowIso = new Date().toISOString();
  const resendKey = env.RESEND_API_KEY?.trim();
  const fromAddress = env.EMAIL_FROM?.trim() || 'MutasiPay <onboarding@resend.dev>';

  if (resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [to],
          subject,
          text: textBody,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Resend HTTP ${response.status}: ${errText}`);
      }

      return {
        status: 'SENT',
        recipient: to,
        provider: 'resend',
        subject,
        messagePreview: textBody,
        sentAt: nowIso,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        recipient: to,
        provider: 'resend',
        subject,
        messagePreview: textBody,
        sentAt: nowIso,
        error: err instanceof Error ? err.message : 'Gagal mengirim via Resend',
      };
    }
  }

  return {
    status: 'SIMULATED_SENT',
    recipient: to,
    provider: 'preview',
    subject,
    messagePreview: textBody,
    sentAt: nowIso,
  };
}

export async function sendWorkerWhatsapp(
  phone: string,
  message: string,
  env: FulfillmentEnv
): Promise<DeliveryChannelLog> {
  const nowIso = new Date().toISOString();
  const normalized = normalizePhone(phone);
  const starsenderKey = env.STARSENDER_API_KEY?.trim();
  const starsenderUrl = env.STARSENDER_BASE_URL?.trim() || 'https://api.starsender.online/api/send';

  // 1. Try Starsender if configured
  if (starsenderKey) {
    try {
      const response = await fetch(starsenderUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: starsenderKey,
        },
        body: JSON.stringify({
          messageType: 'text',
          to: normalized,
          body: message,
        }),
      });

      if (response.ok) {
        return {
          status: 'SENT',
          recipient: phone,
          provider: 'starsender',
          messagePreview: message,
          sentAt: nowIso,
        };
      }
      const errText = await response.text().catch(() => '');
      console.warn(`[Starsender] HTTP ${response.status}: ${errText}`);
    } catch (err: any) {
      console.warn('[Starsender] Error sending WhatsApp message:', err);
    }
  }

  // 2. Try Fonnte or custom WA Gateway
  const waUrl = env.WA_GATEWAY_URL?.trim();
  const waToken = env.WA_API_TOKEN?.trim();
  const waProvider = (env.WA_PROVIDER?.trim() || 'fonnte').toLowerCase();

  if (waUrl && waToken) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: waProvider === 'fonnte' ? waToken : `Bearer ${waToken}`,
      };
      const payload =
        waProvider === 'fonnte'
          ? { target: normalized, message }
          : { phone: normalized, target: normalized, message };

      const response = await fetch(waUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`WhatsApp Gateway HTTP ${response.status}: ${errText}`);
      }

      return {
        status: 'SENT',
        recipient: phone,
        provider: waProvider,
        messagePreview: message,
        sentAt: nowIso,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        recipient: phone,
        provider: waProvider,
        messagePreview: message,
        sentAt: nowIso,
        error: err instanceof Error ? err.message : 'Gagal mengirim via WhatsApp Gateway',
      };
    }
  }

  return {
    status: 'SIMULATED_SENT',
    recipient: phone,
    provider: 'preview',
    messagePreview: message,
    sentAt: nowIso,
  };
}

/**
 * Kirim instruksi tagihan & link pembayaran ke WhatsApp Pembeli saat pesanan baru dibuat (PENDING)
 */
export async function notifyBuyerOrderCreated(
  order: OrderRecord,
  env: FulfillmentEnv,
  paymentUrl: string
): Promise<void> {
  const buyerPhone = order.buyerWhatsapp?.trim();
  if (!buyerPhone || buyerPhone.length < 8) return;

  const formattedAmount = formatRupiah(order.totalAmount);
  const msg = [
    `Halo *${order.buyerName}*! 👋`,
    ``,
    `Terima kasih atas pesanan Anda di *MutasiPay*.`,
    ``,
    `📋 *Detail Pesanan:*`,
    `• Produk: *${order.productName}*`,
    `• Kode Tagihan: \`${order.orderCode}\``,
    `• Total Bayar: *Rp ${formattedAmount}* (termasuk kode unik)`,
    ``,
    `📲 *Halaman Pembayaran QRIS:*`,
    `${paymentUrl}`,
    ``,
    `Silakan buka link di atas untuk scan kode QRIS dan transfer *sesuai nominal persis* (Rp ${formattedAmount}).`,
    `Setelah transfer berhasil, sistem akan otomatis memverifikasi dan mengirimkan akses/lisensi produk ke WhatsApp Anda.`,
    ``,
    `Terima kasih!`
  ].join('\n');

  try {
    await sendWorkerWhatsapp(buyerPhone, msg, env);
  } catch (err) {
    console.error('[Buyer Notification] Gagal mengirim tagihan ke WhatsApp buyer:', err);
  }
}

/**
 * Kirim notifikasi instan ke WhatsApp Owner saat ada pesanan baru dibuat (Menunggu Pembayaran)
 */
export async function notifyOwnerOrderCreated(
  order: OrderRecord,
  env: FulfillmentEnv,
  paymentUrl: string
): Promise<void> {
  const ownerPhone = env.OWNER_WHATSAPP?.trim() || '081230008293';
  if (!ownerPhone) return;

  const formattedAmount = formatRupiah(order.totalAmount);
  const msg = [
    `🔔 *[ORDER BARU] Menunggu Pembayaran QRIS*`,
    ``,
    `Ada pesanan baru masuk ke MutasiPay:`,
    `━━━━━━━━━━━━━━━━━━`,
    `📦 *Produk*: ${order.productName}`,
    `💰 *Total Tagihan*: Rp ${formattedAmount} (Kode unik: ${order.uniqueCode})`,
    `🏷️ *Kode Pesanan*: \`${order.orderCode}\`${order.externalId ? `\n🔖 *Ref External*: \`${order.externalId}\`` : ''}`,
    `👤 *Pembeli*: ${order.buyerName}`,
    `📱 *WhatsApp*: ${order.buyerWhatsapp}`,
    `✉️ *Email*: ${order.buyerEmail}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔗 *Link Pembayaran Pembeli*:`,
    `${paymentUrl}`,
    ``,
    `⏳ Menunggu transfer pembeli. Sistem akan memverifikasi mutasi QRIS otomatis saat pembayaran masuk.`
  ].join('\n');

  try {
    await sendWorkerWhatsapp(ownerPhone, msg, env);
  } catch (err) {
    console.error('[Owner Notification] Gagal mengirim notif order created ke owner:', err);
  }
}

/**
 * Kirim notifikasi instan ke WhatsApp Owner saat pembayaran lunas terverifikasi
 * Berguna sebagai safeguard / backup lisensi jika pengiriman ke buyer via platform luar terkendala
 */
export async function notifyOwnerOrderPaid(
  order: OrderRecord,
  mutation: MutationRecord | undefined,
  env: FulfillmentEnv
): Promise<void> {
  const ownerPhone = env.OWNER_WHATSAPP?.trim() || '081230008293';
  if (!ownerPhone) return;

  const formattedAmount = formatRupiah(order.totalAmount);
  const msg = [
    `✅ *[PEMBAYARAN LUNAS] QRIS Terverifikasi!*`,
    ``,
    `Pembayaran pesanan telah *LUNAS* & terverifikasi otomatis:`,
    `━━━━━━━━━━━━━━━━━━`,
    `📦 *Produk*: ${order.productName}`,
    `💵 *Nominal Masuk*: Rp ${formattedAmount}`,
    `🏷️ *Kode Pesanan*: \`${order.orderCode}\`${order.externalId ? `\n🔖 *Ref External*: \`${order.externalId}\`` : ''}`,
    `👤 *Pembeli*: ${order.buyerName}`,
    `📱 *WhatsApp Pembeli*: ${order.buyerWhatsapp}`,
    `✉️ *Email Pembeli*: ${order.buyerEmail}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🔑 *KUNCI LISENSI PEMBELI*:`,
    `\`${order.licenseKey}\``,
    ``,
    `🌐 *LINK AKSES PRODUK*:`,
    `${order.accessUrl}`,
    `━━━━━━━━━━━━━━━━━━`,
    `🛡️ *CADANGAN OWNER (JAGA-JAGA)*:`,
    `Akses & lisensi telah otomatis dikirimkan ke pembeli. Jika pembeli membeli via platform/landing page lain dan belum menerima aksesnya, Anda dapat langsung meneruskan (forward) pesan ini atau lisensi di atas ke WhatsApp pembeli (${order.buyerWhatsapp}).`
  ].join('\n');

  try {
    await sendWorkerWhatsapp(ownerPhone, msg, env);
  } catch (err) {
    console.error('[Owner Notification] Gagal mengirim notif order paid ke owner:', err);
  }
}
