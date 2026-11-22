import nodemailer from 'nodemailer';
import type {
  DeliveryChannelLog,
  IntegrationStatus,
  MerchantSettings,
  OrderRecord,
} from '../src/types';
import { formatRupiah, parseQrisMetadata } from '../src/lib/qris';
import { renderFulfillmentTemplate } from '../src/lib/matcher';

export function getIntegrationStatus(): IntegrationStatus {
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());
  const hasSmtp = Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim()
  );
  const hasWa = Boolean(process.env.WA_GATEWAY_URL?.trim() && process.env.WA_API_TOKEN?.trim());

  return {
    webhookSecretConfigured: Boolean(process.env.WEBHOOK_SECRET?.trim()),
    externalApiKeyConfigured: Boolean(process.env.EXTERNAL_API_KEY?.trim()),
    outboundSigningSecretConfigured: Boolean(process.env.OUTBOUND_WEBHOOK_SECRET?.trim()),
    emailProvider: hasResend ? 'resend' : hasSmtp ? 'smtp' : 'preview',
    emailConfigured: hasResend || hasSmtp,
    whatsappProvider: process.env.WA_PROVIDER?.trim() || (hasWa ? 'webhook' : 'preview'),
    whatsappConfigured: hasWa,
  };
}

export async function dispatchDigitalFulfillment(
  order: OrderRecord,
  settings: MerchantSettings
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
    sendEmailChannel(order.buyerEmail, emailSubject, emailBody),
    sendWhatsappChannel(order.buyerWhatsapp, whatsappText),
  ]);

  return { emailDelivery, whatsappDelivery };
}

async function sendEmailChannel(
  to: string,
  subject: string,
  textBody: string
): Promise<DeliveryChannelLog> {
  const nowIso = new Date().toISOString();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const fromAddress = process.env.EMAIL_FROM?.trim() || 'MutasiPay <onboarding@resend.dev>';

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

  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpPort = Number.parseInt(process.env.SMTP_PORT || '587', 10);

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number.isNaN(smtpPort) ? 587 : smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        text: textBody,
      });
      return {
        status: 'SENT',
        recipient: to,
        provider: 'smtp',
        subject,
        messagePreview: textBody,
        sentAt: nowIso,
      };
    } catch (err) {
      return {
        status: 'FAILED',
        recipient: to,
        provider: 'smtp',
        subject,
        messagePreview: textBody,
        sentAt: nowIso,
        error: err instanceof Error ? err.message : 'Gagal mengirim via SMTP',
      };
    }
  }

  // Server env credentials not configured yet: record complete preview payload
  return {
    status: 'SIMULATED_SENT',
    recipient: to,
    provider: 'preview',
    subject,
    messagePreview: textBody,
    sentAt: nowIso,
  };
}

async function sendWhatsappChannel(
  phone: string,
  message: string
): Promise<DeliveryChannelLog> {
  const nowIso = new Date().toISOString();
  const waUrl = process.env.WA_GATEWAY_URL?.trim();
  const waToken = process.env.WA_API_TOKEN?.trim();
  const waProvider = (process.env.WA_PROVIDER?.trim() || 'fonnte').toLowerCase();

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
