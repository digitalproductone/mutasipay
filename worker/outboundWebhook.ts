import type { OutboundWebhookEndpoint, OutboundWebhookLog, WebhookEventType } from '../src/types';
import { buildWebhookSignature } from '../src/lib/webhookSigner';
import { insertWebhookLogD1 } from './db';

const DEFAULT_DEV_SIGNING_SECRET = 'mutasipay-webhook-signing-secret';

export async function deliverWorkerWebhook(params: {
  db: D1Database;
  endpointId: string | null;
  endpointName: string;
  url: string;
  event: WebhookEventType;
  data: unknown;
  secret?: string;
}): Promise<OutboundWebhookLog> {
  const deliveryId = `dlv_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const timestampMs = String(Date.now());
  const envelope = {
    id: deliveryId,
    event: params.event,
    created_at: new Date().toISOString(),
    data: params.data,
  };
  const payloadJson = JSON.stringify(envelope);
  const signatureHeader = buildWebhookSignature(
    payloadJson,
    timestampMs,
    params.secret || DEFAULT_DEV_SIGNING_SECRET
  );

  const started = Date.now();
  let httpStatus: number | null = null;
  let status: 'SUCCESS' | 'FAILED' = 'FAILED';
  let responseSnippet = '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const res = await fetch(params.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MutasiPay-CloudflareWorker/1.1',
        'X-MutasiPay-Event': params.event,
        'X-MutasiPay-Delivery': deliveryId,
        'X-MutasiPay-Timestamp': timestampMs,
        'X-MutasiPay-Signature': signatureHeader,
      },
      body: payloadJson,
      signal: controller.signal,
    });
    httpStatus = res.status;
    const rawText = await res.text();
    responseSnippet = rawText.slice(0, 300) || `HTTP ${res.status}`;
    status = res.ok ? 'SUCCESS' : 'FAILED';
  } catch (err) {
    responseSnippet =
      err instanceof Error ? err.message : 'Gagal mengirim request HTTP ke URL webhook.';
  } finally {
    clearTimeout(timeout);
  }

  const log: OutboundWebhookLog = {
    id: `wlog_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
    deliveryId,
    endpointId: params.endpointId,
    endpointName: params.endpointName,
    url: params.url,
    event: params.event,
    status,
    httpStatus,
    durationMs: Date.now() - started,
    payloadJson,
    responseSnippet,
    signatureHeader,
    sentAt: new Date().toISOString(),
  };

  try {
    await insertWebhookLogD1(params.db, log);
  } catch (err) {
    console.error('Failed to save webhook log in D1:', err);
  }

  return log;
}

export async function dispatchWorkerOutboundEvent(
  db: D1Database,
  webhooks: OutboundWebhookEndpoint[],
  event: WebhookEventType,
  data: unknown,
  secret?: string,
  extraCallbackUrl?: string | null
): Promise<OutboundWebhookLog[]> {
  const targets: Array<{ endpointId: string | null; endpointName: string; url: string }> = [];

  for (const ep of webhooks) {
    if (ep.active && ep.events.includes(event)) {
      targets.push({ endpointId: ep.id, endpointName: ep.name, url: ep.url });
    }
  }

  if (
    extraCallbackUrl &&
    /^https?:\/\//i.test(extraCallbackUrl) &&
    !targets.some((t) => t.url === extraCallbackUrl)
  ) {
    targets.push({
      endpointId: null,
      endpointName: 'Per-Order Callback URL',
      url: extraCallbackUrl,
    });
  }

  if (targets.length === 0) return [];

  return Promise.all(
    targets.map((target) =>
      deliverWorkerWebhook({
        db,
        endpointId: target.endpointId,
        endpointName: target.endpointName,
        url: target.url,
        event,
        data,
        secret,
      })
    )
  );
}
