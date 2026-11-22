-- Seed default data into D1
INSERT OR IGNORE INTO qris_channels (
  id, label, provider, provider_name, package_name, static_qris,
  merchant_name, merchant_city, postal_code, nmid, acquirer_domain,
  merchant_pan, merchant_criteria, mcc, crc16, locked, created_at
) VALUES (
  'qris_dana_default', 'DANA Bisnis Utama', 'DANA_BISNIS', 'DANA Bisnis', 'id.dana.merchant',
  '00020101021126570011ID.DANA.WWW011893600915300533321202090053332120303UMI51440014ID.CO.QRIS.WWW0215ID10254515984250303UMI5204581253033605802ID5916AYAM PETOK-PETOK6015Kabupaten Bandu61054055963047F79',
  'AYAM PETOK-PETOK', 'Kabupaten Bandu', '40559', 'ID1025451598425', 'ID.DANA.WWW',
  '936009153005333212', 'UMI', '5812', '7F79', 1, '2026-11-01T00:00:00.000Z'
);

INSERT OR IGNORE INTO products (
  id, name, slug, category, description, price, access_url, license_prefix, file_info, active, created_at
) VALUES
(
  'prod-77c37774', 'Paket Prompt Copywriting Bisnis', 'paket-prompt-copywriting-bisnis-bda2',
  'E-Book & Panduan', 'Koleksi 60 template copywriting iklan dan landing page siap pakai.',
  79000, 'https://akses.ayampetokdigital.id/bundle/copywriting', 'DIGI', 'Notion + PDF 60 Prompt', 1, '2026-11-22T09:39:08.363Z'
),
(
  'prod-ebook-qris', 'Blueprint Jualan Produk Digital & Otomasi QRIS', 'blueprint-produk-digital',
  'E-Book & Panduan', 'Panduan lengkap membangun funnel produk digital hingga sistem pengiriman akses otomatis.',
  99000, 'https://akses.ayampetokdigital.id/library/blueprint-qris-2026', 'BLP', 'PDF 142 hal + Template Notion', 1, '2026-11-08T09:34:22.712Z'
),
(
  'prod-template-kasir', 'Template Pembukuan UMKM & Rekonsiliasi DANA Bisnis', 'template-pembukuan-umkm',
  'Template Spreadsheet', 'Workbook Google Sheets & Excel siap pakai dengan rumus rekonsiliasi otomatis.',
  149000, 'https://akses.ayampetokdigital.id/sheets/umkm-rekonsiliasi-v3', 'UMK', 'Google Sheets + XLSX + Video 25m', 1, '2026-11-13T09:34:22.712Z'
),
(
  'prod-kelas-wa', 'Mini Course Automasi WhatsApp & Email Follow-Up', 'mini-course-automasi-wa',
  'Kelas Video', '8 modul video praktis membangun webhook notifikasi Android MacroDroid & auto-reply.',
  249000, 'https://akses.ayampetokdigital.id/course/automasi-wa-email', 'CRS', '8 Modul Video HD + Script JSON', 1, '2026-11-18T09:34:22.712Z'
);

INSERT OR IGNORE INTO settings (
  id, active_qris_channel_id, static_qris, expiry_minutes, auto_fulfill_enabled,
  email_subject_template, email_body_template, whatsapp_template
) VALUES (
  'default',
  'qris_dana_default',
  '00020101021126570011ID.DANA.WWW011893600915300533321202090053332120303UMI51440014ID.CO.QRIS.WWW0215ID10254515984250303UMI5204581253033605802ID5916AYAM PETOK-PETOK6015Kabupaten Bandu61054055963047F79',
  30, 1,
  'Akses Produk {{nama_produk}} — Pembayaran Terverifikasi ({{kode_pesanan}})',
  'Halo {{nama_pembeli}},\n\nPembayaran QRIS Anda sebesar {{nominal}} ke {{merchant}} telah diverifikasi otomatis oleh sistem kami.\n\nDetail Akses Produk Digital:\n• Produk: {{nama_produk}}\n• Kode Pesanan: {{kode_pesanan}}\n• Kunci Lisensi: {{kunci_lisensi}}\n• Link Akses / Unduh: {{link_akses}}\n\nSimpan email ini sebagai bukti pembelian resmi. Jika membutuhkan bantuan, balas email ini atau hubungi WhatsApp kami.\n\nTerima kasih,\n{{merchant}}',
  'Halo {{nama_pembeli}}!\n\nPembayaran QRIS Anda sebesar *{{nominal}}* ({{kode_pesanan}}) telah *TERVERIFIKASI OTOMATIS*.\n\n*Akses Produk Anda:*\nProduk: {{nama_produk}}\nLisensi: `{{kunci_lisensi}}`\nLink Akses: {{link_akses}}\n\nTerima kasih telah berbelanja di {{merchant}}.'
);
