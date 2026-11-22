import type { OrderRecord } from '../types';

export interface FulfillmentVars {
  nama_pembeli: string;
  nama_produk: string;
  nominal: string;
  kode_pesanan: string;
  link_akses: string;
  kunci_lisensi: string;
  merchant: string;
}

/**
 * Generates a collision-free unique code (default 101..999) so two active pending
 * orders never expect the exact same IDR amount at the same time.
 */
export function generateUniqueCode(
  activeAmounts: Set<number>,
  basePrice: number,
  minCode = 101,
  maxCode = 999,
  rng: () => number = Math.random
): number {
  const span = maxCode - minCode + 1;
  const startOffset = Math.floor(rng() * span);

  for (let i = 0; i < span; i++) {
    const code = minCode + ((startOffset + i) % span);
    if (!activeAmounts.has(basePrice + code)) {
      return code;
    }
  }

  throw new Error('Tidak ada kode unik yang tersedia saat ini. Tunggu pesanan lain selesai.');
}

/**
 * Matches an incoming QRIS mutation nominal strictly against active (PENDING, non-expired) orders.
 * Picks the earliest created matching order if multiple exist.
 */
export function matchMutationToOrder(
  mutationAmount: number,
  orders: OrderRecord[],
  nowMs: number = Date.now()
): OrderRecord | null {
  const candidates = orders
    .filter((order) => {
      if (order.status !== 'PENDING') return false;
      if (order.totalAmount !== mutationAmount) return false;
      const expiresMs = new Date(order.expiresAt).getTime();
      return Number.isFinite(expiresMs) && expiresMs > nowMs;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return candidates[0] ?? null;
}

/**
 * Generates a clean deterministic-format license key for digital product access.
 */
export function generateLicenseKey(prefix: string, orderCode: string): string {
  const cleanPrefix = prefix.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6) || 'DIGI';
  const suffix = orderCode.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(-6);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${cleanPrefix}-${suffix}-${rand}`;
}

/**
 * Normalizes an Indonesian WhatsApp phone number to international format without "+" (e.g. 6281234567890).
 */
export function normalizeWhatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('8')) {
    return `62${digits}`;
  }
  return digits;
}

/**
 * Substitutes {{variable}} tokens in merchant Email & WhatsApp fulfillment templates.
 */
export function renderFulfillmentTemplate(template: string, vars: FulfillmentVars): string {
  const rendered = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => {
    if (key in vars) {
      return vars[key as keyof FulfillmentVars];
    }
    return match;
  });
  return rendered.replace(/\\n/g, '\n');
}
