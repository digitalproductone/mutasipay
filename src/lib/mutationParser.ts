export interface DanaNotificationInput {
  title?: string;
  message: string;
  packageName?: string;
  amount?: number;
  senderName?: string;
  referenceId?: string;
}

export interface ParsedDanaMutation {
  amount: number;
  senderName: string;
  referenceId: string;
  providerPrefix: string;
  isIncomingQris: boolean;
}

const OUTGOING_PATTERNS = [
  /kirim\s+uang/i,
  /transfer\s+ke/i,
  /pembayaran\s+ke\s+/i,
  /penarikan\s+saldo/i,
  /tarik\s+saldo/i,
  /uang\s+keluar/i,
  /withdraw/i,
];

const INCOMING_KEYWORDS = [
  /menerima/i,
  /diterima/i,
  /pembayaran/i,
  /qris/i,
  /dana\s+masuk/i,
  /masuk\s+sebesar/i,
  /transaksi\s+masuk/i,
  /bayar/i,
];

/**
 * Parses an Indonesian rupiah string like "99.247", "99,247", "99.247,00", or "125000" into an integer.
 */
export function parseIndonesianAmount(rawNumber: string): number | null {
  let cleaned = rawNumber.trim();
  if (!cleaned) return null;

  // Strip Indonesian decimal cents (,00) or US decimal (.00) at end
  cleaned = cleaned.replace(/[,.]00$/, '');

  // Remove thousand separators (dots or commas)
  const digitsOnly = cleaned.replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(digitsOnly)) return null;

  const value = Number.parseInt(digitsOnly, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function detectRefPrefix(packageName?: string, combined?: string): string {
  const pkg = (packageName ?? '').toLowerCase();
  const txt = (combined ?? '').toLowerCase();
  if (pkg.includes('bnc') || pkg.includes('neo') || txt.includes('neobank') || txt.includes('bnc')) {
    return 'NEO';
  }
  if (pkg.includes('gojek') || pkg.includes('gopay') || txt.includes('gopay')) {
    return 'GPY';
  }
  if (pkg.includes('shopee') || txt.includes('shopeepay')) {
    return 'SPY';
  }
  return 'DANA';
}

/**
 * Extracts payment nominal, sender name, and reference ID from DANA Bisnis,
 * Neobank (BNC), GoPay Merchant, or other Indonesian QRIS Android notifications.
 */
export function parseDanaNotification(input: DanaNotificationInput): ParsedDanaMutation | null {
  const title = (input.title ?? '').trim();
  const message = (input.message ?? '').trim();
  const combined = `${title} ${message}`.trim();

  if (OUTGOING_PATTERNS.some((pattern) => pattern.test(combined))) {
    return null;
  }

  let amount: number | null =
    typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0
      ? Math.round(input.amount)
      : null;

  if (amount === null) {
    const currencyMatch = combined.match(/(?:Rp\.?|IDR)\s*([0-9][0-9.,]*)/i);
    if (currencyMatch && currencyMatch[1]) {
      amount = parseIndonesianAmount(currencyMatch[1]);
    }
  }

  if (amount === null) {
    return null;
  }

  const isIncomingQris =
    typeof input.amount === 'number' ||
    INCOMING_KEYWORDS.some((pattern) => pattern.test(combined));

  if (!isIncomingQris) {
    return null;
  }

  let senderName = (input.senderName ?? '').trim();
  if (!senderName) {
    const senderMatch = message.match(
      /(?:dari|oleh)\s+([A-Za-z0-9 .'-]{2,40}?)(?:\s+(?:via|melalui|di|dengan|sebesar|pada|ref|id)\b|[.,!]|$)/i
    );
    if (senderMatch && senderMatch[1]) {
      const candidate = senderMatch[1].trim();
      if (!/^(qris|dana|neobank|bnc)$/i.test(candidate)) {
        senderName = candidate;
      }
    }
  }

  const providerPrefix = detectRefPrefix(input.packageName, combined);

  let referenceId = (input.referenceId ?? '').trim();
  if (!referenceId) {
    const refMatch = combined.match(
      /(?:ref(?:erensi)?|id\s*transaksi|trx)\s*[:#-]?\s*([A-Z0-9-]{4,24})/i
    );
    if (refMatch && refMatch[1]) {
      referenceId = refMatch[1].toUpperCase();
    } else {
      referenceId = `${providerPrefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    }
  }

  return {
    amount,
    senderName: senderName || 'Pembeli QRIS',
    referenceId,
    providerPrefix,
    isIncomingQris: true,
  };
}
