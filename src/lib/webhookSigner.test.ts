import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWebhookSignature,
  isValidWebhookUrl,
  verifyWebhookSignature,
} from './webhookSigner';

test('signs and verifies outbound webhook payloads using HMAC-SHA256', () => {
  const payload = JSON.stringify({ event: 'payment.paid', amount: 99247 });
  const ts = '1795340000000';
  const secret = 'mutasipay-outbound-secret';

  const sig = buildWebhookSignature(payload, ts, secret);
  assert.ok(sig.startsWith('sha256='));
  assert.equal(sig.length, 7 + 64);

  assert.equal(verifyWebhookSignature(payload, ts, sig, secret), true);
  assert.equal(verifyWebhookSignature(payload, ts, sig, 'wrong-secret'), false);
  assert.equal(verifyWebhookSignature(`${payload} `, ts, sig, secret), false);
  assert.equal(verifyWebhookSignature(payload, '1795340000001', sig, secret), false);
});

test('validates outbound webhook destination URLs', () => {
  assert.equal(isValidWebhookUrl('https://toko.example.com/api/webhook'), true);
  assert.equal(isValidWebhookUrl('http://localhost:3000/api/v1/webhook-echo'), true);
  assert.equal(isValidWebhookUrl('ftp://example.com/hook'), false);
  assert.equal(isValidWebhookUrl('not-a-url'), false);
});
