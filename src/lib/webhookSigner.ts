import crypto from 'crypto';

export type OutboundWebhookEvent =
  | 'payment.created'
  | 'payment.paid'
  | 'payment.expired'
  | 'mutation.received'
  | 'webhook.ping';

export function buildWebhookSignature(
  payloadJson: string,
  timestampMs: string,
  secret: string
): string {
  const signedContent = `${timestampMs}.${payloadJson}`;
  const digest = crypto.createHmac('sha256', secret).update(signedContent, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

export function verifyWebhookSignature(
  payloadJson: string,
  timestampMs: string,
  providedSignature: string,
  secret: string
): boolean {
  if (!providedSignature || !timestampMs || !secret) return false;
  const expected = buildWebhookSignature(payloadJson, timestampMs, secret);
  const a = Buffer.from(providedSignature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isValidWebhookUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
