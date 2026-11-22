import { useState, type FormEvent } from 'react';
import {
  Check,
  Code2,
  Copy,
  ExternalLink,
  Play,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import type {
  DashboardSnapshot,
  OutboundWebhookEndpoint,
  OutboundWebhookLog,
  WebhookEventType,
} from '../types';
import { copyTextToClipboard, formatDateTime } from '../lib/format';

interface ApiWebhookViewProps {
  snapshot: DashboardSnapshot;
  onRefresh: () => Promise<void>;
}

const ALL_EVENTS: Array<{ id: WebhookEventType; label: string; desc: string }> = [
  {
    id: 'payment.paid',
    label: 'payment.paid',
    desc: 'Dikirim real-time saat mutasi QRIS DANA Bisnis cocok & pembayaran terverifikasi.',
  },
  {
    id: 'payment.created',
    label: 'payment.created',
    desc: 'Dikirim saat tagihan QRIS dinamis baru dibuat (via checkout atau API).',
  },
  {
    id: 'mutation.received',
    label: 'mutation.received',
    desc: 'Dikirim setiap ada notifikasi mutasi QRIS DANA Bisnis masuk (cocok maupun belum cocok).',
  },
  {
    id: 'payment.expired',
    label: 'payment.expired',
    desc: 'Dikirim saat tagihan QRIS melewati batas waktu pembayaran.',
  },
];

type CodeLang = 'curl' | 'node' | 'php';

export function ApiWebhookView({ snapshot, onRefresh }: ApiWebhookViewProps) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app-anda.run.app';
  const apiBase = `${origin}/api/v1`;
  const echoUrl = `${apiBase}/webhook-echo`;

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [codeLang, setCodeLang] = useState<CodeLang>('curl');
  const [activeSnippet, setActiveSnippet] = useState<
    'create' | 'productdyno' | 'qris' | 'status' | 'verify'
  >('create');

  // Interactive API Tester state
  const [testMode, setTestMode] = useState<'dynamic_qris' | 'channels' | 'health' | 'create_payment'>(
    'create_payment'
  );
  const [testChannelId, setTestChannelId] = useState<string>(snapshot.settings.activeQrisChannelId);
  const [testAmount, setTestAmount] = useState('75000');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: number;
    durationMs: number;
    body: string;
  } | null>(null);

  // Outbound Webhook form state
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState<WebhookEventType[]>([
    'payment.paid',
    'mutation.received',
  ]);
  const [whError, setWhError] = useState<string | null>(null);
  const [whSaving, setWhSaving] = useState(false);
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<OutboundWebhookLog | null>(null);

  async function handleCopy(key: string, value: string) {
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  function toggleEventSelection(ev: WebhookEventType) {
    setWhEvents((prev) =>
      prev.includes(ev) ? prev.filter((item) => item !== ev) : [...prev, ev]
    );
  }

  async function handleCreateWebhook(e: FormEvent) {
    e.preventDefault();
    setWhError(null);

    if (!whName.trim() || whName.trim().length < 2) {
      setWhError('Nama integrasi / aplikasi tujuan wajib diisi.');
      return;
    }
    if (!/^https?:\/\//i.test(whUrl.trim())) {
      setWhError('URL Webhook tujuan harus diawali https:// atau http://.');
      return;
    }
    if (whEvents.length === 0) {
      setWhError('Pilih minimal satu event webhook.');
      return;
    }

    setWhSaving(true);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: whName.trim(),
          url: whUrl.trim(),
          events: whEvents,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWhError(data.error || 'Gagal mendaftarkan webhook.');
        return;
      }
      setWhName('');
      setWhUrl('');
      await onRefresh();
    } catch {
      setWhError('Gagal terhubung ke server.');
    } finally {
      setWhSaving(false);
    }
  }

  async function handleToggleWebhook(ep: OutboundWebhookEndpoint) {
    await fetch(`/api/webhooks/${ep.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !ep.active }),
    });
    await onRefresh();
  }

  async function handleDeleteWebhook(id: string) {
    await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
    await onRefresh();
  }

  async function handlePingWebhook(id: string) {
    setPingingId(id);
    try {
      const res = await fetch(`/api/webhooks/${id}/ping`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.log) {
        setSelectedLog(data.log);
      }
      await onRefresh();
    } finally {
      setPingingId(null);
    }
  }

  async function handleRetryLog(logId: string) {
    setRetryingLogId(logId);
    try {
      const res = await fetch(`/api/webhook-logs/${logId}/retry`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.log) {
        setSelectedLog(data.log);
      }
      await onRefresh();
    } finally {
      setRetryingLogId(null);
    }
  }

  async function handleRunApiTest() {
    setTestRunning(true);
    const started = performance.now();
    try {
      let res: Response;
      if (testMode === 'health') {
        res = await fetch('/api/v1/health');
      } else if (testMode === 'channels') {
        res = await fetch('/api/v1/channels');
      } else if (testMode === 'dynamic_qris') {
        const nominal = Math.max(1000, Number.parseInt(testAmount.replace(/\D/g, ''), 10) || 75000);
        res = await fetch('/api/v1/qris/dynamic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base_amount: nominal,
            with_unique_code: true,
            qris_channel_id: testChannelId,
          }),
        });
      } else {
        const nominal = Math.max(1000, Number.parseInt(testAmount.replace(/\D/g, ''), 10) || 75000);
        res = await fetch('/api/v1/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            external_id: `EXT-${Date.now().toString().slice(-6)}`,
            qris_channel_id: testChannelId,
            product_name: 'Integrasi Produk Aplikasi Eksternal',
            amount: nominal,
            buyer_name: 'Tester API',
            buyer_email: 'tester@aplikasi-anda.id',
            buyer_whatsapp: '081234567890',
            access_url: 'https://aplikasi-anda.id/akses/demo',
            return_url: 'https://aplikasi-anda.id/terima-kasih',
            callback_url: echoUrl,
            fulfillment_mode: 'BOTH',
            metadata: {
              productdyno_product_id: 'pd_demo_001',
              license_tier: 'PRO',
            },
          }),
        });
        await onRefresh();
      }

      const json = await res.json();
      const displayObj =
        json && typeof json === 'object' && 'qr_image_data_url' in json
          ? {
              ...json,
              qr_image_data_url: `${String(json.qr_image_data_url).slice(0, 64)}... [PNG base64]`,
            }
          : json;

      setTestResult({
        status: res.status,
        durationMs: Math.round(performance.now() - started),
        body: JSON.stringify(displayObj, null, 2),
      });
    } catch (err) {
      setTestResult({
        status: 0,
        durationMs: Math.round(performance.now() - started),
        body: JSON.stringify(
          { error: err instanceof Error ? err.message : 'Gagal menghubungi API' },
          null,
          2
        ),
      });
    } finally {
      setTestRunning(false);
    }
  }

  function getCodeSnippet(): string {
    if (activeSnippet === 'productdyno') {
      return `// Alur: Landing Page -> MutasiPay -> ProductDyno / Server Lisensi
// 1) Saat klik "Beli" di Landing Page, panggil POST ${apiBase}/payments:
const createRes = await fetch('${apiBase}/payments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer <EXTERNAL_API_KEY>' },
  body: JSON.stringify({
    external_id: 'LP-ORDER-901',
    product_name: 'Software SaaS Pro',
    amount: 199000,
    buyer_name: 'Budi Santoso',
    buyer_email: 'budi@email.com',
    buyer_whatsapp: '081234567890',
    return_url: 'https://landingpage-anda.com/terima-kasih',
    callback_url: 'https://n8n-atau-backend-anda.com/webhook/mutasipay',
    fulfillment_mode: 'EXTERNAL_ONLY', // agar tidak double email dgn ProductDyno
    metadata: {
      productdyno_product_id: 'PD-PRODUCT-ID',
      license_app_plan: 'PRO_1YEAR'
    }
  })
});
const { payment } = await createRes.json();
// Arahkan pembeli ke Hosted Payment Page: payment.payment_url

// 2) Saat Mutasi QRIS masuk, MutasiPay kirim POST event "payment.paid" ke callback_url
//    berisi buyer_email, buyer_name, license_key, & metadata.productdyno_product_id utuh!
//    -> Di n8n / Make / Backend: panggil ProductDyno API (Add Member) & License Server Anda.`;
    }

    if (activeSnippet === 'verify') {
      if (codeLang === 'php') {
        return `<?php
// Verifikasi header X-MutasiPay-Signature di backend PHP / Laravel Anda
$payload = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_MUTASIPAY_TIMESTAMP'] ?? '';
$signature = $_SERVER['HTTP_X_MUTASIPAY_SIGNATURE'] ?? '';
$secret = getenv('OUTBOUND_WEBHOOK_SECRET');

$expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
if (!hash_equals($expected, $signature)) {
  http_response_code(401);
  exit('Invalid signature');
}

$event = json_decode($payload, true);
if ($event['event'] === 'payment.paid') {
  $externalId = $event['data']['external_id'];
  // Aktifkan akses user di database aplikasi Anda
}`;
      }
      return `import crypto from 'crypto';

// Verifikasi header X-MutasiPay-Signature di Express / Next.js Anda
function verifyMutasiPayWebhook(rawBody, timestamp, signature, secret) {
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Saat event === 'payment.paid':
// Aktifkan produk untuk req.body.data.external_id`;
    }

    if (activeSnippet === 'qris') {
      if (codeLang === 'node') {
        return `const res = await fetch('${apiBase}/qris/dynamic', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <EXTERNAL_API_KEY>'
  },
  body: JSON.stringify({
    base_amount: 99000,
    with_unique_code: true
  })
});
const { qris_string, qr_image_data_url, amount } = await res.json();`;
      }
      if (codeLang === 'php') {
        return `<?php
$ch = curl_init('${apiBase}/qris/dynamic');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    'Authorization: Bearer <EXTERNAL_API_KEY>'
  ],
  CURLOPT_POSTFIELDS => json_encode([
    'base_amount' => 99000,
    'with_unique_code' => true
  ])
]);
$data = json_decode(curl_exec($ch), true);`;
      }
      return `curl -X POST "${apiBase}/qris/dynamic" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <EXTERNAL_API_KEY>" \\
  -d '{"base_amount": 99000, "with_unique_code": true}'`;
    }

    if (activeSnippet === 'status') {
      if (codeLang === 'node') {
        return `const res = await fetch('${apiBase}/payments/INV-WEB-001', {
  headers: { 'Authorization': 'Bearer <EXTERNAL_API_KEY>' }
});
const { payment } = await res.json();
// payment.status: 'PENDING' | 'PAID' | 'EXPIRED'`;
      }
      if (codeLang === 'php') {
        return `<?php
$ch = curl_init('${apiBase}/payments/INV-WEB-001');
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ['Authorization: Bearer <EXTERNAL_API_KEY>']
]);
$data = json_decode(curl_exec($ch), true);`;
      }
      return `curl -X GET "${apiBase}/payments/INV-WEB-001" \\
  -H "Authorization: Bearer <EXTERNAL_API_KEY>"`;
    }

    if (codeLang === 'node') {
      return `const res = await fetch('${apiBase}/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <EXTERNAL_API_KEY>'
  },
  body: JSON.stringify({
    external_id: 'INV-WEB-001',
    qris_channel_id: '${snapshot.settings.activeQrisChannelId}', // opsional: pilih DANA / Neobank
    product_name: 'E-Book Bisnis Digital',
    amount: 99000,
    buyer_name: 'Andi Wijaya',
    buyer_email: 'andi@contoh.id',
    buyer_whatsapp: '081234567890',
    return_url: 'https://app-anda.com/thank-you',
    callback_url: 'https://app-anda.com/api/mutasipay-webhook'
  })
});
const { payment, qr_image_data_url } = await res.json();
// Redirect pembeli ke Hosted Payment Page ala Midtrans/Xendit:
// window.location.href = payment.payment_url;`;
    }
    if (codeLang === 'php') {
      return `<?php
$ch = curl_init('${apiBase}/payments');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    'Authorization: Bearer <EXTERNAL_API_KEY>'
  ],
  CURLOPT_POSTFIELDS => json_encode([
    'external_id' => 'INV-WEB-001',
    'qris_channel_id' => '${snapshot.settings.activeQrisChannelId}',
    'product_name' => 'E-Book Bisnis Digital',
    'amount' => 99000,
    'buyer_name' => 'Andi Wijaya',
    'buyer_email' => 'andi@contoh.id',
    'buyer_whatsapp' => '081234567890',
    'return_url' => 'https://app-anda.com/thank-you',
    'callback_url' => 'https://app-anda.com/api/mutasipay-webhook'
  ])
]);
$result = json_decode(curl_exec($ch), true);
// Redirect user ke $result['payment']['payment_url'];`;
    }
    return `curl -X POST "${apiBase}/payments" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <EXTERNAL_API_KEY>" \\
  -d '{
    "external_id": "INV-WEB-001",
    "qris_channel_id": "${snapshot.settings.activeQrisChannelId}",
    "product_name": "E-Book Bisnis Digital",
    "amount": 99000,
    "buyer_name": "Andi Wijaya",
    "buyer_email": "andi@contoh.id",
    "buyer_whatsapp": "081234567890",
    "return_url": "https://app-anda.com/thank-you",
    "callback_url": "https://app-anda.com/api/mutasipay-webhook"
  }'`;
  }

  const currentSnippet = getCodeSnippet();

  return (
    <div className="space-y-5">
      {/* Top API Base URL & Security Summary Strip */}
      <section className="bg-pastel-lime rounded-[28px] p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-[#171A1C]/10">
          <div>
            <h2 className="font-display text-base font-bold text-[#171A1C]">
              Payment Gateway REST API v1 & Outbound Webhook (Ala Midtrans / Xendit)
            </h2>
            <p className="text-xs text-[#2F3E10] mt-1">
              Buat tagihan QRIS Multi-Channel (DANA Bisnis, Neobank, dll.), arahkan pembeli ke <code className="font-mono">payment_url</code> (Hosted Payment Page), dan terima callback HMAC-SHA256 secara real-time.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/api/v1/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 text-xs font-semibold text-[#171A1C] bg-white/85 hover:bg-white rounded-full transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              OpenAPI 3.0 JSON
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              onClick={() => handleCopy('apiBase', apiBase)}
              className="px-4 py-2 text-xs font-semibold text-[#D8F36A] bg-[#171A1C] hover:bg-[#2B3035] rounded-full transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {copiedKey === 'apiBase' ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Base URL Disalin
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Salin Base URL
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-4 rounded-[20px] bg-white/85">
            <p className="text-[#5E656E]">Base URL REST API</p>
            <p className="mt-1 font-mono font-bold text-[#171A1C] truncate">{apiBase}</p>
            <p className="mt-0.5 text-[#6B727B]">CORS aktif · Format JSON</p>
          </div>
          <div className="p-4 rounded-[20px] bg-white/85">
            <p className="text-[#5E656E]">Autentikasi API Eksternal</p>
            <p className="mt-1 font-bold text-[#171A1C]">
              {snapshot.integration.externalApiKeyConfigured
                ? 'Wajib Header Bearer / X-API-Key'
                : 'Mode Terbuka (Set EXTERNAL_API_KEY)'}
            </p>
            <p className="mt-0.5 font-mono text-[#6B727B]">env: EXTERNAL_API_KEY</p>
          </div>
          <div className="p-4 rounded-[20px] bg-white/85">
            <p className="text-[#5E656E]">Signature Webhook Keluar</p>
            <p className="mt-1 font-bold text-[#171A1C]">
              HMAC-SHA256 ·{' '}
              {snapshot.integration.outboundSigningSecretConfigured
                ? 'Secret Produksi Aktif'
                : 'Secret Bawaan Dev'}
            </p>
            <p className="mt-0.5 font-mono text-[#6B727B]">Header: X-MutasiPay-Signature</p>
          </div>
        </div>
      </section>

      {/* Row 2: Outbound Webhook Manager (Left 7) + Live API Tester (Right 5) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Outbound Webhook Subscriptions */}
        <section className="lg:col-span-7 bg-white border border-[#ECEEE6] rounded-[28px] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#F2F3EE] flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold text-[#171A1C]">
                Webhook Keluar ke Aplikasi Lain ({snapshot.webhooks.length})
              </h2>
              <p className="text-xs text-[#6B727B] mt-0.5">
                MutasiPay mengirim HTTP POST bertanda tangan HMAC-SHA256 ke URL tujuan setiap ada pembayaran lunas atau mutasi masuk.
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-pastel-lavender flex items-center justify-center shrink-0">
              <Webhook className="w-4 h-4 text-[#4B1D5C]" aria-hidden="true" />
            </div>
          </div>

          <form onSubmit={handleCreateWebhook} className="p-6 border-b border-[#F2F3EE] space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5">
                <label htmlFor="wh-name" className="block text-xs font-semibold text-[#3C424A] mb-1.5">
                  Nama Aplikasi Tujuan
                </label>
                <input
                  id="wh-name"
                  type="text"
                  value={whName}
                  onChange={(e) => setWhName(e.target.value)}
                  placeholder="Contoh: Toko Next.js / n8n"
                  className="w-full px-4 py-2.5 text-xs bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
                />
              </div>

              <div className="sm:col-span-7">
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="wh-url" className="text-xs font-semibold text-[#3C424A]">
                    URL Endpoint Penerima (POST)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      if (!whName) setWhName('Echo Test Receiver');
                      setWhUrl(echoUrl);
                    }}
                    className="text-[11px] font-semibold text-[#7E2FA0] hover:underline"
                  >
                    Pakai URL Uji Echo
                  </button>
                </div>
                <input
                  id="wh-url"
                  type="url"
                  value={whUrl}
                  onChange={(e) => setWhUrl(e.target.value)}
                  placeholder="https://aplikasi-anda.com/api/webhook/mutasipay"
                  className="w-full px-4 py-2.5 text-xs font-mono bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-[#3C424A] mb-2">Event yang Dikirim</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {ALL_EVENTS.map((ev) => (
                  <label
                    key={ev.id}
                    className="flex items-start gap-2.5 p-3 rounded-2xl bg-[#F6F7F4] hover:bg-[#F0F2EB] transition-colors cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={whEvents.includes(ev.id)}
                      onChange={() => toggleEventSelection(ev.id)}
                      className="mt-0.5 rounded border-[#D0D5C8] accent-[#171A1C]"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-mono font-bold text-[#171A1C]">
                        {ev.label}
                      </span>
                      <span className="block text-[11px] text-[#6B727B] leading-snug mt-0.5">
                        {ev.desc}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {whError && (
              <p role="alert" className="text-xs font-semibold text-[#C83E2B]">
                {whError}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={whSaving}
                className="px-5 py-2.5 text-xs font-semibold text-[#171A1C] bg-pastel-cta disabled:opacity-50 rounded-full transition-all inline-flex items-center gap-1.5 shadow-2xs"
              >
                <Plus className="w-3.5 h-3.5" />
                {whSaving ? 'Menyimpan...' : 'Daftarkan Endpoint Webhook'}
              </button>
            </div>
          </form>

          {snapshot.webhooks.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#6B727B]">
              Belum ada endpoint webhook keluar yang terdaftar. Klik{' '}
              <strong className="text-[#171A1C]">Pakai URL Uji Echo</strong> di atas untuk langsung mencoba pengiriman webhook bertanda tangan HMAC-SHA256.
            </div>
          ) : (
            <div className="divide-y divide-[#F2F3EE]">
              {snapshot.webhooks.map((ep) => (
                <div
                  key={ep.id}
                  className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold text-[#171A1C]">{ep.name}</span>
                      <span aria-hidden="true" className="text-[#CBD0C4]">·</span>
                      <span className={ep.active ? 'text-[#3C6E14] font-semibold' : 'text-[#7D858E]'}>
                        {ep.active ? 'Aktif' : 'Dijeda'}
                      </span>
                    </div>
                    <p className="text-xs font-mono text-[#5E656E] truncate mt-0.5">{ep.url}</p>
                    <p className="text-[11px] font-mono text-[#8A929C] mt-1">
                      {ep.events.join(' · ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={pingingId === ep.id}
                      onClick={() => handlePingWebhook(ep.id)}
                      className="px-3.5 py-1.5 text-xs font-semibold text-[#D8F36A] bg-[#171A1C] hover:bg-[#2B3035] disabled:opacity-50 rounded-full inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Send className="w-3 h-3" />
                      {pingingId === ep.id ? 'Mengirim...' : 'Kirim Ping Uji'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleWebhook(ep)}
                      className="px-3 py-1.5 text-xs font-semibold text-[#4B525A] bg-[#F5F6F2] hover:bg-[#ECEEE6] rounded-full whitespace-nowrap"
                    >
                      {ep.active ? 'Jeda' : 'Aktifkan'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Hapus webhook ${ep.name}`}
                      onClick={() => handleDeleteWebhook(ep.id)}
                      className="w-8 h-8 rounded-full bg-[#F5F6F2] text-[#8A929C] hover:text-[#C83E2B] hover:bg-[#FFE4DE] flex items-center justify-center"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Live API Playground */}
        <section className="lg:col-span-5 bg-white border border-[#ECEEE6] rounded-[28px] p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-[#171A1C]">
                Tester REST API Langsung
              </h2>
              <p className="text-xs text-[#6B727B] mt-0.5">
                Jalankan request langsung ke server API v1 dan lihat respon JSON real-time.
              </p>
            </div>
            <div className="w-10 h-10 rounded-full bg-pastel-lime flex items-center justify-center shrink-0">
              <Code2 className="w-4 h-4 text-[#171A1C]" aria-hidden="true" />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="api-test-endpoint"
                className="block text-xs font-semibold text-[#3C424A] mb-1.5"
              >
                Endpoint Uji
              </label>
              <select
                id="api-test-endpoint"
                value={testMode}
                onChange={(e) =>
                  setTestMode(
                    e.target.value as 'dynamic_qris' | 'channels' | 'health' | 'create_payment'
                  )
                }
                className="w-full px-4 py-2.5 text-xs font-mono bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              >
                <option value="create_payment">POST /api/v1/payments (Hosted Page + QRIS)</option>
                <option value="channels">GET /api/v1/channels (daftar Multi-QRIS)</option>
                <option value="dynamic_qris">POST /api/v1/qris/dynamic</option>
                <option value="health">GET /api/v1/health</option>
              </select>
            </div>

            {(testMode === 'create_payment' || testMode === 'dynamic_qris') && (
              <>
                <div>
                  <label
                    htmlFor="api-test-channel"
                    className="block text-xs font-semibold text-[#3C424A] mb-1.5"
                  >
                    Channel QRIS (qris_channel_id)
                  </label>
                  <select
                    id="api-test-channel"
                    value={testChannelId}
                    onChange={(e) => setTestChannelId(e.target.value)}
                    className="w-full px-4 py-2.5 text-xs bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
                  >
                    {snapshot.qrisChannels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.label} ({ch.providerName})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="api-test-amount"
                    className="block text-xs font-semibold text-[#3C424A] mb-1.5"
                  >
                    Nominal Dasar (Rupiah)
                  </label>
                  <input
                    id="api-test-amount"
                    type="number"
                    min={1000}
                    step={1000}
                    value={testAmount}
                    onChange={(e) => setTestAmount(e.target.value)}
                    className="w-full px-4 py-2.5 text-xs font-mono tabular-nums bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
                  />
                </div>
              </>
            )}

            <button
              type="button"
              disabled={testRunning}
              onClick={handleRunApiTest}
              className="w-full px-5 py-3 text-xs font-semibold text-[#171A1C] bg-pastel-cta disabled:opacity-50 rounded-full transition-all inline-flex items-center justify-center gap-1.5 shadow-2xs"
            >
              <Play className="w-3.5 h-3.5" />
              {testRunning ? 'Menjalankan Request...' : 'Jalankan Request API'}
            </button>
          </div>

          {testResult ? (
            <div className="space-y-2 pt-2 border-t border-[#F2F3EE]">
              <div className="flex items-center justify-between text-xs font-mono">
                <span
                  className={
                    testResult.status >= 200 && testResult.status < 300
                      ? 'text-[#3C6E14] font-bold'
                      : 'text-[#C83E2B] font-bold'
                  }
                >
                  HTTP {testResult.status}
                </span>
                <span className="text-[#6B727B] tabular-nums">{testResult.durationMs} ms</span>
              </div>
              <pre className="p-4 bg-[#171A1C] text-[#F1F5EE] rounded-2xl text-[11px] font-mono overflow-x-auto max-h-72 overflow-y-auto leading-relaxed">
                {testResult.body}
              </pre>
            </div>
          ) : (
            <div className="p-4 bg-[#F6F7F4] rounded-2xl text-xs text-[#6B727B]">
              Klik <strong className="text-[#171A1C]">Jalankan Request API</strong> untuk menguji konversi QRIS dinamis DANA Bisnis atau pembuatan tagihan eksternal via REST API.
            </div>
          )}
        </section>
      </div>

      {/* Row 3: Code Examples & Endpoint Reference */}
      <section className="bg-white border border-[#ECEEE6] rounded-[28px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F2F3EE] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#171A1C]">
              Dokumentasi Endpoint & Contoh Kode Integrasi
            </h2>
            <p className="text-xs text-[#6B727B] mt-0.5">
              Salin potongan kode berikut ke backend aplikasi Anda (Node.js, Laravel/PHP, atau cURL).
            </p>
          </div>

          <div
            className="flex items-center gap-1 p-1 bg-[#F5F6F2] rounded-full w-fit"
            role="tablist"
            aria-label="Bahasa kode"
          >
            {(
              [
                { id: 'curl', label: 'cURL' },
                { id: 'node', label: 'Node.js' },
                { id: 'php', label: 'PHP / Laravel' },
              ] as const
            ).map((lang) => (
              <button
                key={lang.id}
                type="button"
                role="tab"
                aria-selected={codeLang === lang.id}
                onClick={() => setCodeLang(lang.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition-all whitespace-nowrap ${
                  codeLang === lang.id
                    ? 'bg-white border border-[#CBE855] text-[#171A1C] font-semibold shadow-2xs'
                    : 'text-[#5E656E] hover:text-[#171A1C]'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#F2F3EE]">
          <div className="lg:col-span-5 divide-y divide-[#F2F3EE]">
            {(
              [
                {
                  id: 'create',
                  method: 'POST',
                  path: '/api/v1/payments',
                  desc: 'Buat transaksi QRIS dinamis + Hosted Payment URL (payment_url) dengan metadata bebas.',
                },
                {
                  id: 'productdyno',
                  method: 'FLOW',
                  path: 'Landing Page → ProductDyno / Lisensi',
                  desc: 'Pola integrasi metadata passthrough + fulfillment_mode EXTERNAL_ONLY untuk ProductDyno, n8n, & server lisensi.',
                },
                {
                  id: 'qris',
                  method: 'POST',
                  path: '/api/v1/qris/dynamic',
                  desc: 'Generate string & gambar QRIS dinamis Multi-Channel tanpa membuat order.',
                },
                {
                  id: 'status',
                  method: 'GET',
                  path: '/api/v1/payments/:id',
                  desc: 'Cek status pembayaran berdasarkan ID, kode pesanan, atau external_id.',
                },
                {
                  id: 'verify',
                  method: 'HMAC',
                  path: 'X-MutasiPay-Signature',
                  desc: 'Verifikasi tanda tangan SHA-256 pada webhook keluar yang masuk ke server Anda.',
                },
              ] as const
            ).map((ep) => {
              const active = activeSnippet === ep.id;
              return (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => setActiveSnippet(ep.id)}
                  className={`w-full text-left px-6 py-4 transition-colors ${
                    active ? 'bg-[#F8FDE8]' : 'hover:bg-[#FAFBF8]'
                  }`}
                >
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span
                      className={`font-bold ${
                        ep.method === 'POST'
                          ? 'text-[#7E2FA0]'
                          : ep.method === 'GET'
                            ? 'text-[#3C6E14]'
                            : ep.method === 'FLOW'
                              ? 'text-[#1D6FA5]'
                              : 'text-[#C85A17]'
                      }`}
                    >
                      {ep.method}
                    </span>
                    <span className="font-semibold text-[#171A1C]">{ep.path}</span>
                  </div>
                  <p className="text-xs text-[#6B727B] mt-1 leading-relaxed">{ep.desc}</p>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-7 p-6 bg-[#171A1C] text-[#F1F5EE] flex flex-col justify-between">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10 text-xs">
              <span className="font-mono text-[#A8B1A2]">
                {activeSnippet === 'productdyno'
                  ? 'Alur Integrasi Landing Page → MutasiPay → ProductDyno / Lisensi'
                  : activeSnippet === 'verify'
                    ? 'Verifikasi Webhook Signature'
                    : activeSnippet === 'qris'
                      ? 'POST /api/v1/qris/dynamic'
                      : activeSnippet === 'status'
                        ? 'GET /api/v1/payments/:id'
                        : 'POST /api/v1/payments'}
              </span>
              <button
                type="button"
                onClick={() => handleCopy('snippet', currentSnippet)}
                className="px-3 py-1 text-xs font-semibold text-[#171A1C] bg-[#D8F36A] hover:bg-[#CBE855] rounded-full inline-flex items-center gap-1.5 transition-colors"
              >
                {copiedKey === 'snippet' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Disalin
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Salin Kode
                  </>
                )}
              </button>
            </div>
            <pre className="text-xs font-mono leading-relaxed overflow-x-auto flex-1">
              {currentSnippet}
            </pre>
          </div>
        </div>
      </section>

      {/* Row 4: Outbound Webhook Delivery History */}
      <section className="bg-white border border-[#ECEEE6] rounded-[28px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F2F3EE] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#171A1C]">
              Riwayat Pengiriman Webhook Keluar ({snapshot.webhookLogs.length})
            </h2>
            <p className="text-xs text-[#6B727B] mt-0.5">
              Log real-time setiap callback HTTP POST yang dikirim MutasiPay ke aplikasi eksternal Anda.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#F2F3EE] bg-[#FAFBF8] text-xs font-semibold text-[#6B727B]">
                <th className="py-3.5 px-6">Waktu</th>
                <th className="py-3.5 px-4">Event & Tujuan</th>
                <th className="py-3.5 px-4">HTTP Status</th>
                <th className="py-3.5 px-4 text-right">Latensi</th>
                <th className="py-3.5 px-6 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2F3EE] text-xs">
              {snapshot.webhookLogs.slice(0, 15).map((log) => (
                <tr
                  key={log.id}
                  onClick={() => setSelectedLog(selectedLog?.id === log.id ? null : log)}
                  className="hover:bg-[#FAFBF8] transition-colors cursor-pointer"
                >
                  <td className="py-3.5 px-6 font-mono text-[#6B727B] tabular-nums whitespace-nowrap">
                    {formatDateTime(log.sentAt)}
                  </td>
                  <td className="py-3.5 px-4">
                    <p className="font-mono font-bold text-[#171A1C]">{log.event}</p>
                    <p className="text-[#6B727B] truncate max-w-md mt-0.5">
                      {log.endpointName} · {log.url}
                    </p>
                  </td>
                  <td className="py-3.5 px-4 font-mono whitespace-nowrap">
                    <span
                      className={
                        log.status === 'SUCCESS'
                          ? 'text-[#3C6E14] font-bold'
                          : 'text-[#C83E2B] font-bold'
                      }
                    >
                      {log.httpStatus ? `HTTP ${log.httpStatus}` : 'Gagal Koneksi'}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-[#5E656E] tabular-nums whitespace-nowrap">
                    {log.durationMs} ms
                  </td>
                  <td className="py-3.5 px-6 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={retryingLogId === log.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRetryLog(log.id);
                      }}
                      className="px-3.5 py-1.5 text-xs font-semibold text-[#171A1C] bg-[#F5F6F2] hover:bg-[#E7F4B5] rounded-full inline-flex items-center gap-1 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${retryingLogId === log.id ? 'animate-spin' : ''}`}
                      />
                      Kirim Ulang
                    </button>
                  </td>
                </tr>
              ))}
              {snapshot.webhookLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[#6B727B]">
                    Belum ada pengiriman webhook keluar. Daftarkan URL di atas dan klik{' '}
                    <strong className="text-[#171A1C]">Kirim Ping Uji</strong> untuk melihat log pengiriman real-time.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedLog && (
          <div className="p-6 border-t border-[#F2F3EE] bg-[#FAFBF8] space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <p className="font-mono font-bold text-[#171A1C]">
                Detail Delivery {selectedLog.deliveryId} · {selectedLog.event}
              </p>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-3 py-1 rounded-full bg-white border border-[#ECEEE6] text-[#5E656E] hover:text-[#171A1C]"
              >
                Tutup
              </button>
            </div>
            <p className="font-mono text-[11px] text-[#5E656E] break-all">
              X-MutasiPay-Signature: {selectedLog.signatureHeader}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <p className="font-semibold text-[#3C424A] mb-1.5">Payload JSON Terkirim</p>
                <pre className="p-3.5 bg-white border border-[#ECEEE6] rounded-2xl font-mono text-[11px] text-[#171A1C] overflow-x-auto max-h-48">
                  {selectedLog.payloadJson}
                </pre>
              </div>
              <div>
                <p className="font-semibold text-[#3C424A] mb-1.5">Respon Server Tujuan</p>
                <pre className="p-3.5 bg-white border border-[#ECEEE6] rounded-2xl font-mono text-[11px] text-[#171A1C] overflow-x-auto max-h-48 whitespace-pre-wrap">
                  {selectedLog.responseSnippet}
                </pre>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
