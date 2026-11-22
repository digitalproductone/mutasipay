import type { DeliveryChannelLog, MerchantSettings, OrderRecord } from '../src/types';
import { formatRupiah, parseQrisMetadata } from '../src/lib/qris';
import { renderFulfillmentTemplate } from '../src/lib/matcher';

export interface FulfillmentEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  WA_GATEWAY_URL?: string;
  WA_API_TOKEN?: string;
  WA_PROVIDER?: string;
}

export function getWorkerIntegrationStatus(env: FulfillmentEnv) {
  const hasResend = Boolean(env.RESEND_API_KEY?.trim());
  const hasWa = Boolean(env.WA_GATEWAY_URL?.trim() && env.WA_API_TOKEN?.trim());

  return {
    webhookSecretConfigured: true,
    externalApiKeyConfigured: false,
    outboundSigningSecretConfigured: true,
    emailProvider: hasResend ? 'resend' : 'preview',
    emailConfigured: hasResend,
    whatsappProvider: env.WA_PROVIDER?.trim() || (hasWa ? 'webhook' : 'preview'),
    whatsappConfigured: hasWa,
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

async function sendWorkerWhatsapp(
  phone: string,
  message: string,
  env: FulfillmentEnv
): Promise<DeliveryChannelLog> {
  const nowIso = new Date().toISOString();
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
          ? { target: phone, message }
          : { phone, target: phone, message };

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
