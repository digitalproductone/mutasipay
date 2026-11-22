-- MutasiPay D1 Database Schema
CREATE TABLE IF NOT EXISTS qris_channels (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  package_name TEXT NOT NULL,
  static_qris TEXT NOT NULL,
  merchant_name TEXT NOT NULL,
  merchant_city TEXT NOT NULL,
  postal_code TEXT,
  nmid TEXT,
  acquirer_domain TEXT,
  merchant_pan TEXT,
  merchant_criteria TEXT,
  mcc TEXT,
  crc16 TEXT,
  locked INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  access_url TEXT NOT NULL,
  license_prefix TEXT NOT NULL,
  file_info TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_code TEXT UNIQUE NOT NULL,
  external_id TEXT,
  callback_url TEXT,
  return_url TEXT,
  fulfillment_mode TEXT,
  metadata TEXT,
  qris_channel_id TEXT,
  qris_channel_label TEXT,
  qris_provider TEXT,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  buyer_name TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  buyer_whatsapp TEXT NOT NULL,
  base_amount INTEGER NOT NULL,
  unique_code INTEGER NOT NULL,
  total_amount INTEGER NOT NULL,
  dynamic_qris TEXT NOT NULL,
  status TEXT NOT NULL,
  access_url TEXT NOT NULL,
  license_key TEXT NOT NULL,
  matched_mutation_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  email_delivery TEXT,
  whatsapp_delivery TEXT
);

CREATE TABLE IF NOT EXISTS mutations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  package_name TEXT NOT NULL,
  provider_name TEXT,
  title TEXT NOT NULL,
  raw_message TEXT NOT NULL,
  amount INTEGER NOT NULL,
  sender_name TEXT,
  reference_id TEXT,
  status TEXT NOT NULL,
  matched_order_id TEXT,
  matched_order_code TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  endpoint_id TEXT,
  endpoint_name TEXT NOT NULL,
  url TEXT NOT NULL,
  event TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  duration_ms INTEGER,
  payload_json TEXT NOT NULL,
  response_snippet TEXT,
  signature_header TEXT,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  active_qris_channel_id TEXT NOT NULL,
  static_qris TEXT NOT NULL,
  expiry_minutes INTEGER NOT NULL DEFAULT 30,
  auto_fulfill_enabled INTEGER NOT NULL DEFAULT 1,
  email_subject_template TEXT NOT NULL,
  email_body_template TEXT NOT NULL,
  whatsapp_template TEXT NOT NULL
);
