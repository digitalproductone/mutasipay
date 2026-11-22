export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header';
  required?: boolean;
  description?: string;
  schema?: {
    type?: string;
    enum?: string[];
    default?: unknown;
  };
}

export interface OpenApiPropertySchema {
  type?: string;
  enum?: string[];
  example?: unknown;
  description?: string;
}

export interface OpenApiOperation {
  summary?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: {
      'application/json'?: {
        schema?: {
          type?: string;
          required?: string[];
          properties?: Record<string, OpenApiPropertySchema>;
        };
      };
    };
  };
  responses?: Record<string, { description?: string }>;
}

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
}

export type EndpointCategory = 'Pembayaran & QRIS' | 'Gateway & Channel' | 'Mutasi & Webhook';

export type AuthHeaderMode = 'BEARER_API_KEY' | 'WEBHOOK_SECRET' | 'HMAC_SIGNATURE';

export interface EndpointFieldDoc {
  name: string;
  type: string;
  required: boolean;
  example: string;
  enumValues?: string[];
  description: string;
}

export interface DynamicEndpointDoc {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  fullUrl: string;
  summary: string;
  category: EndpointCategory;
  authMode: AuthHeaderMode;
  authLabel: string;
  parameters: OpenApiParameter[];
  bodyFields: EndpointFieldDoc[];
  sampleBody: Record<string, unknown> | null;
  responses: Array<{ status: string; description: string }>;
  curlExample: string;
}

export interface BuildDocsOptions {
  baseUrl?: string;
  activeChannelId?: string;
  externalApiKeyConfigured?: boolean;
  webhookSecretConfigured?: boolean;
}

function classifyEndpoint(path: string): {
  category: EndpointCategory;
  authMode: AuthHeaderMode;
  authLabel: string;
} {
  if (path.startsWith('/webhooks/')) {
    return {
      category: 'Mutasi & Webhook',
      authMode: 'WEBHOOK_SECRET',
      authLabel: 'Header: X-Webhook-Secret',
    };
  }
  if (path === '/webhook-echo') {
    return {
      category: 'Mutasi & Webhook',
      authMode: 'HMAC_SIGNATURE',
      authLabel: 'Header: X-MutasiPay-Signature (HMAC-SHA256)',
    };
  }
  if (path.startsWith('/mutations')) {
    return {
      category: 'Mutasi & Webhook',
      authMode: 'BEARER_API_KEY',
      authLabel: 'Authorization: Bearer <EXTERNAL_API_KEY>',
    };
  }
  if (path.startsWith('/payments') || path.startsWith('/qris')) {
    return {
      category: 'Pembayaran & QRIS',
      authMode: 'BEARER_API_KEY',
      authLabel: 'Authorization: Bearer <EXTERNAL_API_KEY>',
    };
  }
  return {
    category: 'Gateway & Channel',
    authMode: 'BEARER_API_KEY',
    authLabel: 'Authorization: Bearer <EXTERNAL_API_KEY>',
  };
}

function formatExampleValue(value: unknown): string {
  if (value === undefined || value === null) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildSampleUrl(baseApiUrl: string, path: string, params: OpenApiParameter[]): string {
  let resolvedPath = path;
  for (const param of params) {
    if (param.in === 'path') {
      resolvedPath = resolvedPath.replace(`{${param.name}}`, 'MP-261101');
    }
  }
  const queryParams = params.filter((p) => p.in === 'query');
  if (queryParams.length > 0) {
    const first = queryParams[0];
    const sampleVal = first.schema?.enum?.[0] ?? first.schema?.default ?? 'PAID';
    return `${baseApiUrl}${resolvedPath}?${first.name}=${encodeURIComponent(String(sampleVal))}`;
  }
  return `${baseApiUrl}${resolvedPath}`;
}

export function generateCurlForEndpoint(input: {
  method: string;
  url: string;
  authMode: AuthHeaderMode;
  sampleBody: Record<string, unknown> | null;
}): string {
  const lines: string[] = [`curl -X ${input.method} "${input.url}"`];

  if (input.authMode === 'BEARER_API_KEY') {
    lines.push('  -H "Authorization: Bearer <EXTERNAL_API_KEY>"');
  } else if (input.authMode === 'WEBHOOK_SECRET') {
    lines.push('  -H "X-Webhook-Secret: <WEBHOOK_SECRET>"');
  } else if (input.authMode === 'HMAC_SIGNATURE') {
    lines.push('  -H "X-MutasiPay-Event: webhook.ping"');
    lines.push('  -H "X-MutasiPay-Timestamp: 1763814000"');
    lines.push('  -H "X-MutasiPay-Signature: sha256=<HASIL_HMAC_SHA256>"');
  }

  if (input.sampleBody && Object.keys(input.sampleBody).length > 0) {
    lines.push('  -H "Content-Type: application/json"');
    const serialized = JSON.stringify(input.sampleBody, null, 2);
    lines.push(`  -d '${serialized}'`);
  }

  return lines.join(' \\\n');
}

export function generateDynamicDeveloperDocs(
  spec: OpenApiSpec,
  options: BuildDocsOptions = {}
): DynamicEndpointDoc[] {
  const rawServerUrl = options.baseUrl
    ? `${options.baseUrl.replace(/\/+$/, '')}/api/v1`
    : (spec.servers?.[0]?.url ?? 'http://localhost:3000/api/v1').replace(/\/+$/, '');

  const docs: DynamicEndpointDoc[] = [];

  for (const [pathKey, methodsObj] of Object.entries(spec.paths ?? {})) {
    for (const [rawMethod, operation] of Object.entries(methodsObj ?? {})) {
      const method = rawMethod.toUpperCase() as DynamicEndpointDoc['method'];
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;

      const { category, authMode, authLabel } = classifyEndpoint(pathKey);
      const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];

      const jsonSchema = operation.requestBody?.content?.['application/json']?.schema;
      const requiredFields = new Set(jsonSchema?.required ?? []);
      const bodyFields: EndpointFieldDoc[] = [];
      let sampleBody: Record<string, unknown> | null = null;

      if (jsonSchema?.properties) {
        sampleBody = {};
        for (const [fieldName, prop] of Object.entries(jsonSchema.properties)) {
          let exampleVal = prop.example;
          if (fieldName === 'qris_channel_id' && options.activeChannelId) {
            exampleVal = options.activeChannelId;
          }

          bodyFields.push({
            name: fieldName,
            type: prop.type ?? 'string',
            required: requiredFields.has(fieldName),
            example: formatExampleValue(exampleVal),
            enumValues: prop.enum,
            description: prop.description ?? '',
          });

          // Pick clean realistic subset for POST /payments sample body (avoid mutually exclusive amount + product_id confusion)
          if (exampleVal !== undefined && !(pathKey === '/payments' && fieldName === 'product_id')) {
            if (!(pathKey === '/qris/dynamic' && fieldName === 'amount')) {
              sampleBody[fieldName] = exampleVal;
            }
          }
        }
      }

      const fullUrl = `${rawServerUrl}${pathKey}`;
      const sampleUrl = buildSampleUrl(rawServerUrl, pathKey, parameters);
      const responses = Object.entries(operation.responses ?? {}).map(([status, r]) => ({
        status,
        description: r?.description ?? 'OK',
      }));

      docs.push({
        id: `${method.toLowerCase()}-${pathKey.replace(/[^a-z0-9]+/gi, '-')}`,
        method,
        path: `/api/v1${pathKey}`,
        fullUrl,
        summary: operation.summary ?? `${method} ${pathKey}`,
        category,
        authMode,
        authLabel,
        parameters,
        bodyFields,
        sampleBody,
        responses,
        curlExample: generateCurlForEndpoint({
          method,
          url: sampleUrl,
          authMode,
          sampleBody,
        }),
      });
    }
  }

  return docs;
}

export interface HmacVerificationGuide {
  algorithm: string;
  signedPayloadFormula: string;
  headers: Array<{ name: string; example: string; purpose: string }>;
  snippets: {
    curl: string;
    node: string;
    php: string;
    python: string;
  };
}

export function buildHmacVerificationGuide(baseUrl: string): HmacVerificationGuide {
  const cleanOrigin = baseUrl.replace(/\/+$/, '');
  const echoEndpoint = `${cleanOrigin}/api/v1/webhook-echo`;

  return {
    algorithm: 'HMAC-SHA256 (Hex lowercase dengan prefiks "sha256=")',
    signedPayloadFormula: '${X-MutasiPay-Timestamp}.${rawRequestBody}',
    headers: [
      {
        name: 'X-MutasiPay-Signature',
        example: 'sha256=9f3a8c...d41e',
        purpose: 'Tanda tangan HMAC-SHA256 menggunakan OUTBOUND_WEBHOOK_SECRET',
      },
      {
        name: 'X-MutasiPay-Timestamp',
        example: '1763814000',
        purpose: 'Unix timestamp (detik) saat webhook dikirim — tolak jika selisih > 5 menit',
      },
      {
        name: 'X-MutasiPay-Event',
        example: 'payment.paid',
        purpose: 'Jenis event: payment.paid, payment.created, mutation.received, webhook.ping',
      },
      {
        name: 'X-MutasiPay-Delivery',
        example: 'dlv_8a1f2c90b4',
        purpose: 'ID pengiriman unik untuk deduplikasi / idempotency di server Anda',
      },
    ],
    snippets: {
      curl: `# 1. Hitung signature HMAC-SHA256 menggunakan openssl & uji langsung ke endpoint echo:
SECRET="<OUTBOUND_WEBHOOK_SECRET_ANDA>"
TS=$(date +%s)
BODY='{"event":"payment.paid","data":{"order_code":"MP-261101","status":"PAID","total_amount":99214}}'
SIG=$(printf "%s.%s" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')

curl -X POST "${echoEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-MutasiPay-Event: payment.paid" \\
  -H "X-MutasiPay-Delivery: dlv_test_001" \\
  -H "X-MutasiPay-Timestamp: \${TS}" \\
  -H "X-MutasiPay-Signature: sha256=\${SIG}" \\
  -d "$BODY"`,
      node: `import crypto from 'crypto';

// Express / Next.js Route Handler — gunakan RAW body string (jangan JSON.stringify ulang)
export function verifyMutasiPaySignature({ rawBody, timestamp, signature, secret }) {
  if (!rawBody || !timestamp || !signature || !secret) return false;

  // 1. Cegah replay attack (maksimal selisih 5 menit / 300 detik)
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 300) return false;

  // 2. Hitung HMAC-SHA256 atas "\${timestamp}.\${rawBody}"
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(\`\${timestamp}.\${rawBody}\`).digest('hex');

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;

  // 3. Bandingkan secara constant-time untuk mencegah timing attack
  return crypto.timingSafeEqual(sigBuf, expBuf);
}`,
      php: `<?php
// Laravel / PHP Webhook Controller — baca raw body langsung dari php://input
$rawBody   = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_MUTASIPAY_TIMESTAMP'] ?? '';
$signature = $_SERVER['HTTP_X_MUTASIPAY_SIGNATURE'] ?? '';
$secret    = getenv('OUTBOUND_WEBHOOK_SECRET');

// 1. Validasi timestamp (maksimal selisih 300 detik)
if (abs(time() - intval($timestamp)) > 300) {
  http_response_code(400);
  exit('Timestamp kedaluwarsa');
}

// 2. Hitung HMAC-SHA256 & bandingkan dengan hash_equals
$expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
if (!hash_equals($expected, $signature)) {
  http_response_code(401);
  exit('Signature HMAC tidak valid');
}

$payload = json_decode($rawBody, true);
if (($payload['event'] ?? '') === 'payment.paid') {
  $orderCode = $payload['data']['order_code'];
  $metadata  = $payload['data']['metadata'] ?? [];
  // Aktifkan akses produk / panggil ProductDyno atau server lisensi Anda di sini
}`,
      python: `import hashlib, hmac, time
from fastapi import FastAPI, Header, HTTPException, Request

app = FastAPI()
WEBHOOK_SECRET = "OUTBOUND_WEBHOOK_SECRET_ANDA"

@app.post("/webhook/mutasipay")
async def handle_mutasipay_webhook(
    request: Request,
    x_mutasipay_timestamp: str = Header(...),
    x_mutasipay_signature: str = Header(...),
):
    raw_body = (await request.body()).decode("utf-8")

    # 1. Cegah replay attack (toleransi 300 detik)
    if abs(int(time.time()) - int(x_mutasipay_timestamp)) > 300:
        raise HTTPException(status_code=400, detail="Timestamp expired")

    # 2. Verifikasi HMAC-SHA256 secara constant-time
    signed = f"{x_mutasipay_timestamp}.{raw_body}".encode("utf-8")
    expected = "sha256=" + hmac.new(WEBHOOK_SECRET.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, x_mutasipay_signature):
        raise HTTPException(status_code=401, detail="Invalid HMAC signature")

    payload = await request.json()
    return {"received": True, "event": payload.get("event")}`,
    },
  };
}
