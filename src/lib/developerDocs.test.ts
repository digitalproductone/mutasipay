import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiSpec } from '../../server/openapi';
import {
  buildHmacVerificationGuide,
  generateDynamicDeveloperDocs,
  type OpenApiSpec,
} from './developerDocs';

test('dynamically generates endpoint docs and cURL commands from live OpenAPI 3.0 spec', () => {
  const baseUrl = 'https://gateway.tokoanda.id';
  const spec = buildOpenApiSpec(baseUrl) as unknown as OpenApiSpec;
  const docs = generateDynamicDeveloperDocs(spec, {
    baseUrl,
    activeChannelId: 'qris_neobank_01',
  });

  // Ensure every major API v1 endpoint is dynamically generated
  const paths = docs.map((d) => `${d.method} ${d.path}`);
  assert.ok(paths.includes('GET /api/v1/health'));
  assert.ok(paths.includes('GET /api/v1/channels'));
  assert.ok(paths.includes('GET /api/v1/products'));
  assert.ok(paths.includes('POST /api/v1/payments'));
  assert.ok(paths.includes('GET /api/v1/payments/{id}'));
  assert.ok(paths.includes('POST /api/v1/qris/dynamic'));
  assert.ok(paths.includes('POST /api/v1/webhooks/mutation'));
  assert.ok(paths.includes('POST /api/v1/webhook-echo'));

  // Verify activeChannelId is dynamically injected into POST /api/v1/payments cURL & sample body
  const createPayment = docs.find((d) => d.method === 'POST' && d.path === '/api/v1/payments');
  assert.ok(createPayment);
  assert.equal(createPayment.sampleBody?.qris_channel_id, 'qris_neobank_01');
  assert.ok(createPayment.curlExample.includes('https://gateway.tokoanda.id/api/v1/payments'));
  assert.ok(createPayment.curlExample.includes('Authorization: Bearer <EXTERNAL_API_KEY>'));
  assert.ok(createPayment.curlExample.includes('"qris_channel_id": "qris_neobank_01"'));
  assert.ok(createPayment.bodyFields.some((f) => f.name === 'buyer_email' && f.required));
  assert.ok(createPayment.bodyFields.some((f) => f.name === 'metadata' && !f.required));

  // Verify webhook endpoint uses X-Webhook-Secret header in cURL
  const mutationWebhook = docs.find(
    (d) => d.method === 'POST' && d.path === '/api/v1/webhooks/mutation'
  );
  assert.ok(mutationWebhook);
  assert.equal(mutationWebhook.authMode, 'WEBHOOK_SECRET');
  assert.ok(mutationWebhook.curlExample.includes('X-Webhook-Secret: <WEBHOOK_SECRET>'));
});

test('builds complete HMAC-SHA256 verification guide with dynamic echo URL and multi-language snippets', () => {
  const guide = buildHmacVerificationGuide('https://pay.contoh.id/');
  assert.equal(guide.headers.length, 4);
  assert.ok(guide.headers.some((h) => h.name === 'X-MutasiPay-Signature'));
  assert.ok(guide.snippets.curl.includes('https://pay.contoh.id/api/v1/webhook-echo'));
  assert.ok(guide.snippets.curl.includes('openssl dgst -sha256 -hmac'));
  assert.ok(guide.snippets.node.includes('timingSafeEqual'));
  assert.ok(guide.snippets.php.includes('hash_equals'));
  assert.ok(guide.snippets.python.includes('hmac.compare_digest'));
});
