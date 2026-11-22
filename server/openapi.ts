export function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'MutasiPay Multi-QRIS Payment Gateway API',
      version: '1.1.0',
      description:
        'Payment Gateway mandiri berbasis Multi-QRIS (DANA Bisnis, Neobank BNC, GoPay Merchant, ShopeePay, QRIS Bank) dengan Hosted Payment Page, REST API v1, dan Outbound Webhook HMAC-SHA256.',
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Gunakan header Authorization: Bearer <EXTERNAL_API_KEY> atau X-API-Key jika dikonfigurasi di server.',
        },
      },
    },
    security: [{ BearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          summary: 'Cek status gateway dan channel QRIS yang sedang aktif',
          responses: { '200': { description: 'Status sehat & metadata merchant QRIS aktif' } },
        },
      },
      '/channels': {
        get: {
          summary: 'Daftar seluruh channel Multi-QRIS terkunci (DANA Bisnis, Neobank, dll.)',
          responses: { '200': { description: 'Daftar channel QRIS dan ID channel aktif' } },
        },
      },
      '/qris/dynamic': {
        post: {
          summary: 'Konversi QRIS statis (aktif atau channel tertentu) menjadi QRIS dinamis dengan nominal persis',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    amount: { type: 'integer', example: 99247 },
                    base_amount: { type: 'integer', example: 99000 },
                    with_unique_code: { type: 'boolean', example: true },
                    qris_channel_id: { type: 'string', example: 'qris_dana_default' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'QRIS dinamis valid + gambar PNG data URL' } },
        },
      },
      '/payments': {
        get: {
          summary: 'Daftar transaksi pembayaran QRIS (filter status atau external_id)',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'PAID', 'EXPIRED'] } },
            { name: 'external_id', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'Daftar pembayaran' } },
        },
        post: {
          summary: 'Buat tagihan pembayaran QRIS & dapatkan payment_url (Hosted Payment Page ala Midtrans/Xendit)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['buyer_name', 'buyer_email', 'buyer_whatsapp'],
                  properties: {
                    external_id: { type: 'string', example: 'INV-WEB-2026-001' },
                    qris_channel_id: { type: 'string', example: 'qris_dana_default' },
                    product_id: { type: 'string', example: 'prod-ebook-qris' },
                    product_name: { type: 'string', example: 'E-Book Premium' },
                    amount: { type: 'integer', example: 99000 },
                    buyer_name: { type: 'string', example: 'Rina Kusuma' },
                    buyer_email: { type: 'string', example: 'rina@contoh.id' },
                    buyer_whatsapp: { type: 'string', example: '081234567890' },
                    access_url: { type: 'string', example: 'https://app-anda.com/akses/123' },
                    return_url: { type: 'string', example: 'https://app-anda.com/thank-you' },
                    callback_url: { type: 'string', example: 'https://app-anda.com/api/webhook/mutasipay' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Tagihan QRIS dinamis + Hosted Payment Page URL dibuat' } },
        },
      },
      '/payments/{id}': {
        get: {
          summary: 'Cek status pembayaran berdasarkan ID internal, kode pesanan, atau external_id',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Detail pembayaran, channel QRIS, payment_url & status pengiriman' } },
        },
      },
      '/mutations': {
        get: {
          summary: 'Ambil daftar mutasi Multi-QRIS masuk (DANA Bisnis, Neobank, dll.)',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['MATCHED', 'UNMATCHED'] } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { '200': { description: 'Daftar mutasi QRIS masuk' } },
        },
      },
      '/webhooks/mutation': {
        post: {
          summary: 'Webhook penerima notifikasi Android Multi-QRIS (DANA Bisnis, Neobank BNC, GoPay, ShopeePay)',
          responses: { '201': { description: 'Mutasi diproses & dicocokkan otomatis' } },
        },
      },
      '/webhooks/dana': {
        post: {
          summary: 'Alias kompatibilitas webhook notifikasi Android DANA Bisnis',
          responses: { '201': { description: 'Mutasi diproses & dicocokkan otomatis' } },
        },
      },
      '/webhook-echo': {
        post: {
          summary: 'Endpoint echo bawaan untuk menguji webhook keluar + verifikasi HMAC-SHA256',
          responses: { '200': { description: 'Payload diterima & status verifikasi HMAC dikembalikan' } },
        },
      },
    },
  };
}
