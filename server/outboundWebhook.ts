import crypto from 'crypto';
import type {
  OutboundWebhookEndpoint,
  OutboundWebhookLog,
  WebhookEventType,
} from '../src/types';
import { buildWebhookSignature } from '../src/lib/webhookSigner';
import { loadStore, saveStore } from './store';

const DEFAULT_DEV_SIGNING_SECRET = 'mutasipay-webhook-signing-secret';

export function getOutboundSigningSecret(): string {
  return process.env.OUTBOUND_WEBHOOK_SECRET?.trim() || DEFAULT_DEV_SIGNING_SECRET;
}

export async function deliverWebhookToUrl(params: {
  endpointId: string | null;
  endpointName: string;
  url: string;
  event: WebhookEventType;
  data: unknown;
}): Promise<OutboundWebhookLog> {
  const deliveryId = `dlv_${crypto.randomBytes(6).toString('hex')}`;
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
    getOutboundSigningSecret()
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
        'User-Agent': 'MutasiPay-Webhook/1.0',
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
    id: `wlog_${crypto.randomBytes(5).toString('hex')}`,
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

  const store = loadStore();
  store.webhookLogs.unshift(log);
  if (store.webhookLogs.length > 100) {
    store.webhookLogs = store.webhookLogs.slice(0, 100);
  }
  saveStore(store);

  return log;
}

export async function dispatchOutboundEvent(
  event: WebhookEventType,
  data: unknown,
  extraCallbackUrl?: string | null
): Promise<OutboundWebhookLog[]> {
  const store = loadStore();
  const targets: Array<{ endpointId: string | null; endpointName: string; url: string }> = [];

  for (const ep of store.webhooks) {
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
      deliverWebhookToUrl({
        endpointId: target.endpointId,
        endpointName: target.endpointName,
        url: target.url,
        event,
        data,
      })
    )
  );
}

export async function pingWebhookEndpoint(
  endpoint: OutboundWebhookEndpoint
): Promise<OutboundWebhookLog> {
  return deliverWebhookToUrl({
    endpointId: endpoint.id,
    endpointName: endpoint.name,
    url: endpoint.url,
    event: 'webhook.ping',
    data: {
      message: 'Ping verifikasi koneksi webhook dari MutasiPay DANA Bisnis.',
      endpoint_id: endpoint.id,
      subscribed_events: endpoint.events,
    },
  });
}
