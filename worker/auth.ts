import type { Context } from 'hono';

export interface AuthEnv {
  DB: D1Database;
  OWNER_EMAIL?: string;
  OWNER_PASSWORD?: string;
  OWNER_WHATSAPP?: string;
  STARSENDER_BASE_URL?: string;
  STARSENDER_API_KEY?: string;
  WA_GATEWAY_URL?: string;
  WA_API_TOKEN?: string;
  WA_PROVIDER?: string;
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  return digits;
}

export function maskPhone(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 8) return clean;
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export function generateOtpCode(): string {
  // Generate cryptographically strong 6-digit code
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const num = (array[0] % 900000) + 100000;
  return String(num);
}

export async function sendOtpViaWhatsApp(
  toPhone: string,
  otpCode: string,
  env: AuthEnv
): Promise<{ sent: boolean; provider: string; message: string }> {
  const normalized = normalizePhone(toPhone);
  const starsenderKey = env.STARSENDER_API_KEY?.trim();
  const starsenderUrl = env.STARSENDER_BASE_URL?.trim() || 'https://api.starsender.online/api/send';

  const messageText = `🔐 *KODE KEAMANAN MUTASIPAY (2FA)*\n\nKode verifikasi Anda adalah: *${otpCode}*\n\nKode ini berlaku selama 5 menit. Masukkan kode ini pada portal login untuk mengakses dashboard admin MutasiPay.\n\n⚠️ *PENTING*: Jangan berikan kode ini kepada siapa pun demi keamanan gateway QRIS Anda.`;

  // 1. Try Starsender if API key is present
  if (starsenderKey) {
    try {
      const res = await fetch(starsenderUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: starsenderKey,
        },
        body: JSON.stringify({
          messageType: 'text',
          to: normalized,
          body: messageText,
        }),
      });

      if (res.ok) {
        return {
          sent: true,
          provider: 'starsender',
          message: `Kode OTP berhasil dikirim ke WhatsApp ${maskPhone(toPhone)} via Starsender.`,
        };
      }
      const errText = await res.text().catch(() => '');
      console.warn(`[Starsender] HTTP ${res.status}: ${errText}`);
    } catch (err) {
      console.warn('[Starsender] Error sending message:', err);
    }
  }

  // 2. Try Fonnte / Generic WA Gateway if configured
  const waUrl = env.WA_GATEWAY_URL?.trim();
  const waToken = env.WA_API_TOKEN?.trim();
  const waProvider = (env.WA_PROVIDER?.trim() || 'fonnte').toLowerCase();

  if (waUrl && waToken) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: waProvider === 'fonnte' ? waToken : `Bearer ${waToken}`,
      };
      const payload =
        waProvider === 'fonnte'
          ? { target: normalized, message: messageText }
          : { phone: normalized, target: normalized, message: messageText };

      const res = await fetch(waUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return {
          sent: true,
          provider: waProvider,
          message: `Kode OTP berhasil dikirim ke WhatsApp ${maskPhone(toPhone)} via ${waProvider}.`,
        };
      }
    } catch (err) {
      console.warn('[WA Gateway] Error sending OTP:', err);
    }
  }

  // Fallback to simulated mode (always log to console so admin can still log in if gateway is down)
  console.info(`[MUTASIPAY 2FA SIMULATED OTP] Kode OTP untuk ${toPhone}: ${otpCode}`);
  return {
    sent: false,
    provider: 'simulated',
    message: `Gateway WhatsApp offline; kode OTP dicatat secara aman di log sistem.`,
  };
}

export async function createSession(db: D1Database, email: string): Promise<string> {
  const token = `mps_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(); // 14 days

  await db
    .prepare(
      'INSERT INTO auth_sessions (token, email, expires_at, created_at) VALUES (?, ?, ?, ?)'
    )
    .bind(token, email, expiresAt, now.toISOString())
    .run();

  return token;
}

export async function verifySession(db: D1Database, token: string): Promise<{ valid: boolean; email?: string }> {
  if (!token) return { valid: false };

  const nowIso = new Date().toISOString();
  const res = await db
    .prepare('SELECT email, expires_at FROM auth_sessions WHERE token = ? AND expires_at > ?')
    .bind(token, nowIso)
    .first();

  if (!res) return { valid: false };
  return { valid: true, email: String(res.email) };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  if (!token) return;
  await db.prepare('DELETE FROM auth_sessions WHERE token = ?').bind(token).run();
}

export function getSessionTokenFromRequest(c: Context): string {
  const header =
    c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    c.req.header('x-session-token')?.trim();
  if (header) return header;

  const cookieHeader = c.req.header('cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/mutasipay_session_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1].trim());
  }
  return '';
}
