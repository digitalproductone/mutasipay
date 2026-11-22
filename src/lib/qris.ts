export const DEFAULT_DANA_STATIC_QRIS =
  '00020101021126570011ID.DANA.WWW011893600915300533321202090053332120303UMI51440014ID.CO.QRIS.WWW0215ID10254515984250303UMI5204581253033605802ID5916AYAM PETOK-PETOK6015Kabupaten Bandu61054055963047F79';

export interface TlvTag {
  tag: string;
  length: number;
  value: string;
}

export interface QrisMetadata {
  valid: boolean;
  crcExpected: string;
  crcProvided: string;
  isDynamic: boolean;
  pointOfInitiation: string;
  merchantName: string;
  merchantCity: string;
  postalCode: string;
  acquirerDomain: string;
  merchantPan: string;
  merchantId: string;
  nmid: string;
  merchantCriteria: string;
  mcc: string;
  currencyCode: string;
  countryCode: string;
  amount: number | null;
}

/**
 * Computes EMVCo CRC-16/CCITT-FALSE (polynomial 0x1021, initial value 0xFFFF).
 */
export function calculateCrc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Parses an EMVCo TLV (Tag-Length-Value) string into ordered tag entries.
 */
export function parseTlv(data: string): TlvTag[] {
  const tags: TlvTag[] = [];
  let index = 0;

  while (index + 4 <= data.length) {
    const tag = data.slice(index, index + 2);
    const lengthStr = data.slice(index + 2, index + 4);
    const length = Number.parseInt(lengthStr, 10);

    if (Number.isNaN(length) || length < 0 || index + 4 + length > data.length) {
      break;
    }

    const value = data.slice(index + 4, index + 4 + length);
    tags.push({ tag, length, value });
    index += 4 + length;
  }

  return tags;
}

function serializeTlv(tags: Array<{ tag: string; value: string }>): string {
  return tags
    .map(({ tag, value }) => `${tag}${String(value.length).padStart(2, '0')}${value}`)
    .join('');
}

/**
 * Decodes an Indonesian QRIS payload (such as DANA Bisnis QRIS) and verifies CRC-16.
 */
export function parseQrisMetadata(qrisString: string): QrisMetadata {
  const trimmed = qrisString.trim();
  const topTags = parseTlv(trimmed);
  const tagMap = new Map(topTags.map((t) => [t.tag, t.value]));

  const crcProvided = (tagMap.get('63') ?? '').toUpperCase();
  const payloadWithoutCrcValue = trimmed.length >= 4 ? trimmed.slice(0, -4) : '';
  const crcExpected = payloadWithoutCrcValue ? calculateCrc16Ccitt(payloadWithoutCrcValue) : '';
  const valid = Boolean(crcProvided) && crcProvided === crcExpected && tagMap.get('00') === '01';

  // Acquirer account block (typically tag 26 for DANA Bisnis, fallback 27..45)
  let acquirerBlock = tagMap.get('26') ?? '';
  if (!acquirerBlock) {
    for (let t = 27; t <= 45; t++) {
      const candidate = tagMap.get(String(t));
      if (candidate) {
        acquirerBlock = candidate;
        break;
      }
    }
  }
  const acquirerSub = new Map(parseTlv(acquirerBlock).map((t) => [t.tag, t.value]));
  const qrisSub = new Map(parseTlv(tagMap.get('51') ?? '').map((t) => [t.tag, t.value]));

  const pointOfInitiation = tagMap.get('01') ?? '11';
  const rawAmount = tagMap.get('54');
  const parsedAmount = rawAmount ? Number.parseFloat(rawAmount) : null;

  return {
    valid,
    crcExpected,
    crcProvided,
    isDynamic: pointOfInitiation === '12',
    pointOfInitiation,
    merchantName: tagMap.get('59') ?? 'Merchant QRIS',
    merchantCity: tagMap.get('60') ?? '-',
    postalCode: tagMap.get('61') ?? '-',
    acquirerDomain: acquirerSub.get('00') ?? '-',
    merchantPan: acquirerSub.get('01') ?? '-',
    merchantId: acquirerSub.get('02') ?? '-',
    nmid: qrisSub.get('02') ?? '-',
    merchantCriteria: qrisSub.get('03') ?? acquirerSub.get('03') ?? '-',
    mcc: tagMap.get('52') ?? '-',
    currencyCode: tagMap.get('53') ?? '360',
    countryCode: tagMap.get('58') ?? 'ID',
    amount: parsedAmount !== null && !Number.isNaN(parsedAmount) ? parsedAmount : null,
  };
}

/**
 * Converts a static QRIS string (01=11) into a dynamic QRIS string (01=12)
 * with exact integer Rupiah nominal injected into Tag 54 and valid CRC-16 (Tag 63).
 */
export function generateDynamicQris(staticQris: string, amountIdr: number): string {
  const cleanAmount = Math.round(amountIdr);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    throw new Error('Nominal pembayaran harus lebih dari Rp 0.');
  }

  const trimmed = staticQris.trim();
  const parsedTags = parseTlv(trimmed);
  if (parsedTags.length === 0 || parsedTags[0].tag !== '00') {
    throw new Error('Format string QRIS tidak valid.');
  }

  // Strip existing CRC (63) and existing amount (54) so we rebuild cleanly
  const filtered = parsedTags
    .filter((t) => t.tag !== '63' && t.tag !== '54')
    .map((t) => ({
      tag: t.tag,
      value: t.tag === '01' ? '12' : t.value,
    }));

  // Insert Tag 54 right after Tag 53 (Currency) per EMVCo specification
  const amountTag = { tag: '54', value: String(cleanAmount) };
  const idx53 = filtered.findIndex((t) => t.tag === '53');
  if (idx53 !== -1) {
    filtered.splice(idx53 + 1, 0, amountTag);
  } else {
    const idx58 = filtered.findIndex((t) => t.tag === '58');
    if (idx58 !== -1) {
      filtered.splice(idx58, 0, amountTag);
    } else {
      filtered.push(amountTag);
    }
  }

  const payloadWithoutCrc = `${serializeTlv(filtered)}6304`;
  const crc = calculateCrc16Ccitt(payloadWithoutCrc);
  return `${payloadWithoutCrc}${crc}`;
}

export function formatRupiah(amount: number): string {
  const formatted = new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
  return `Rp ${formatted}`;
}
