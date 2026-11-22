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
      '/products': {
        get: {
          summary: 'Daftar produk digital aktif yang tersedia di katalog MutasiPay',
          responses: { '200': { description: 'Array produk digital aktif beserta harga dan slug' } },
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
                    amount: { type: 'integer', example: 99247, description: 'Nominal akhir persis jika tanpa kode unik otomatis.' },
                    base_amount: { type: 'integer', example: 99000, description: 'Nominal dasar sebelum ditambah kode unik.' },
                    with_unique_code: { type: 'boolean', example: true, description: 'Tambahkan kode unik anti-bentrok (+101 s/d +999).' },
                    qris_channel_id: { type: 'string', example: 'qris_dana_default', description: 'Opsional: ID channel QRIS tujuan (default ke channel aktif).' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'QRIS dinamis valid + gambar PNG data URL' },
            '400': { description: 'Nominal di bawah Rp 100 atau payload QRIS tidak valid' },
          },
        },
      },
      '/payments': {
        get: {
          summary: 'Daftar transaksi pembayaran QRIS (filter status atau external_id)',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['PENDING', 'PAID', 'EXPIRED'] }, description: 'Filter status pembayaran' },
            { name: 'external_id', in: 'query', schema: { type: 'string' }, description: 'Filter berdasarkan ID invoice aplikasi Anda' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: 'Jumlah maksimum hasil (1–100)' },
          ],
          responses: { '200': { description: 'Daftar pembayaran beserta payment_url dan status pengiriman' } },
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
                    external_id: { type: 'string', example: 'INV-WEB-2026-001', description: 'ID invoice unik dari aplikasi atau landing page Anda.' },
                    qris_channel_id: { type: 'string', example: 'qris_dana_default', description: 'Opsional: ID channel Multi-QRIS (DANA Bisnis, Neobank, dll.).' },
                    product_id: { type: 'string', example: 'prod-ebook-qris', description: 'Opsional: ID produk katalog MutasiPay (atau isi product_name + amount).' },
                    product_name: { type: 'string', example: 'E-Book Premium', description: 'Nama produk jika dibuat ad-hoc dari aplikasi eksternal.' },
                    amount: { type: 'integer', example: 99000, description: 'Nominal dasar dalam Rupiah (minimal Rp 1.000).' },
                    buyer_name: { type: 'string', example: 'Rina Kusuma', description: 'Nama lengkap pembeli.' },
                    buyer_email: { type: 'string', example: 'rina@contoh.id', description: 'Email pembeli untuk akses produk & notifikasi.' },
                    buyer_whatsapp: { type: 'string', example: '081234567890', description: 'Nomor WhatsApp pembeli (otomatis dinormalisasi ke 62xxx).' },
                    access_url: { type: 'string', example: 'https://app-anda.com/akses/123', description: 'Link akses / unduh produk digital.' },
                    return_url: { type: 'string', example: 'https://app-anda.com/thank-you', description: 'URL redirect tombol Kembali ke Aplikasi setelah lunas.' },
                    callback_url: { type: 'string', example: 'https://app-anda.com/api/webhook/mutasipay', description: 'URL webhook khusus per transaksi (menerima event HMAC-SHA256).' },
                    fulfillment_mode: {
                      type: 'string',
                      enum: ['BOTH', 'EXTERNAL_ONLY'],
                      example: 'EXTERNAL_ONLY',
                      description: 'Gunakan EXTERNAL_ONLY bila pengiriman akses/email sudah ditangani ProductDyno atau server lisensi eksternal.',
                    },
                    metadata: {
                      type: 'object',
                      example: { productdyno_product_id: 'pd_12345', license_tier: 'PRO', source_lp: 'lp-ebook' },
                      description: 'Data bebas (JSON) yang akan diteruskan ulang utuh di webhook payment.paid.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Tagihan QRIS dinamis + Hosted Payment Page URL dibuat' },
            '400': { description: 'Validasi input gagal (email, WhatsApp, nominal, atau URL tidak valid)' },
          },
        },
      },
      '/payments/{id}': {
        get: {
          summary: 'Cek status pembayaran berdasarkan ID internal, kode pesanan, atau external_id',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'ID internal (ord-...), order_code (MP-...), atau external_id' },
          ],
          responses: {
            '200': { description: 'Detail pembayaran, channel QRIS, payment_url, metadata & status pengiriman' },
            '404': { description: 'Pembayaran tidak ditemukan' },
          },
        },
      },
      '/mutations': {
        get: {
          summary: 'Ambil daftar mutasi Multi-QRIS masuk (DANA Bisnis, Neobank, dll.)',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['MATCHED', 'UNMATCHED'] }, description: 'Filter mutasi cocok atau belum cocok' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: 'Jumlah maksimum hasil (1–100)' },
          ],
          responses: { '200': { description: 'Daftar mutasi QRIS masuk lengkap dengan provider_name' } },
        },
      },
      '/webhooks/mutation': {
        post: {
          summary: 'Webhook penerima notifikasi Android Multi-QRIS (DANA Bisnis, Neobank BNC, GoPay, ShopeePay)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    title: { type: 'string', example: 'Neobank (BNC) — Pembayaran QRIS', description: 'Judul notifikasi Android.' },
                    message: { type: 'string', example: 'Anda menerima pembayaran QRIS sebesar Rp 99.247 dari BUDI SANTOSO di Neobank', description: 'Isi teks notifikasi pembayaran masuk.' },
                    packageName: { type: 'string', example: 'com.bnc.finance', description: 'Package aplikasi Android (id.dana.merchant / com.bnc.finance).' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Mutasi diproses, dicocokkan otomatis, dan memicu webhook keluar payment.paid' },
            '401': { description: 'Header X-Webhook-Secret tidak cocok' },
            '422': { description: 'Notifikasi bukan transaksi pembayaran masuk yang dikenali' },
          },
        },
      },
      '/webhooks/dana': {
        post: {
          summary: 'Alias kompatibilitas webhook notifikasi Android DANA Bisnis',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message'],
                  properties: {
                    title: { type: 'string', example: 'DANA Bisnis', description: 'Judul notifikasi DANA Bisnis.' },
                    message: { type: 'string', example: 'Kamu baru saja menerima pembayaran Rp 99.247 melalui QRIS dari BUDI SANTOSO', description: 'Isi teks notifikasi DANA Bisnis.' },
                    packageName: { type: 'string', example: 'id.dana.merchant', description: 'Package name DANA Bisnis.' },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Mutasi diproses & dicocokkan otomatis' },
            '401': { description: 'Header X-Webhook-Secret tidak cocok' },
          },
        },
      },
      '/webhook-echo': {
        post: {
          summary: 'Endpoint echo bawaan untuk menguji webhook keluar + verifikasi HMAC-SHA256',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    event: { type: 'string', example: 'webhook.ping', description: 'Nama event webhook.' },
                    data: { type: 'object', example: { message: 'Halo MutasiPay Echo' }, description: 'Payload data uji.' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Payload diterima & status verifikasi HMAC-SHA256 dikembalikan' } },
        },
      },
    },
  };
}
