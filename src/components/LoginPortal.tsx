import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Zap,
} from 'lucide-react';

interface LoginPortalProps {
  onLoginSuccess: () => void;
}

type AuthPhase = 'LOGIN' | 'OTP' | 'PORTAL';

export function LoginPortal({ onLoginSuccess }: LoginPortalProps) {
  const [phase, setPhase] = useState<AuthPhase>('LOGIN');
  const [email, setEmail] = useState('digitalproductoneclub@gmail.com');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [whatsappMasked, setWhatsappMasked] = useState('0812••••8293');
  const [countdown, setCountdown] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const otpInputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Countdown timer for resend OTP
  useEffect(() => {
    if (phase !== 'OTP' || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => c - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, countdown]);

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Email atau password salah.');
      }

      if (data.whatsapp_masked) {
        setWhatsappMasked(data.whatsapp_masked);
      }
      setPhase('OTP');
      setCountdown(60);
      setOtpDigits(['', '', '', '', '', '']);
      setSuccessMsg(data.message || 'Kode OTP telah dikirim ke WhatsApp Anda.');
      setTimeout(() => {
        otpInputsRef.current[0]?.focus();
      }, 100);
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat masuk.');
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(index: number, value: string) {
    if (value.length > 1) {
      // Pasted full OTP (e.g. "123456")
      const pastedDigits = value.replace(/\D/g, '').slice(0, 6).split('');
      const newDigits = [...otpDigits];
      pastedDigits.forEach((digit, i) => {
        newDigits[i] = digit;
      });
      setOtpDigits(newDigits);
      const nextIndex = Math.min(pastedDigits.length, 5);
      otpInputsRef.current[nextIndex]?.focus();
      return;
    }

    const clean = value.replace(/\D/g, '');
    const newDigits = [...otpDigits];
    newDigits[index] = clean;
    setOtpDigits(newDigits);

    if (clean && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  }

  async function handleVerifyOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError(null);
    const fullOtp = otpDigits.join('');
    if (fullOtp.length !== 6) {
      setError('Masukkan 6 digit kode OTP secara lengkap.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), otp_code: fullOtp }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Kode OTP tidak valid.');
      }

      // Store authenticated token in localStorage
      if (data.token) {
        localStorage.setItem('mutasipay_session_token', data.token);
      }

      // Move to Entry Portal screen as requested by user!
      setPhase('PORTAL');
    } catch (err: any) {
      setError(err.message || 'Gagal memverifikasi OTP.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    if (countdown > 0 || loading) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal mengirim ulang OTP.');
      }
      setCountdown(60);
      setSuccessMsg('Kode OTP baru telah dikirim ke WhatsApp Anda.');
    } catch (err: any) {
      setError(err.message || 'Gagal mengirim ulang kode.');
    } finally {
      setLoading(false);
    }
  }

  function handleLogoutFromPortal() {
    localStorage.removeItem('mutasipay_session_token');
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setPhase('LOGIN');
    setPassword('');
    setOtpDigits(['', '', '', '', '', '']);
    setError(null);
    setSuccessMsg(null);
  }

  return (
    <div className="min-h-screen bg-[#EAEDE1] text-[#171A1C] flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8 font-sans selection:bg-[#CBE855] selection:text-[#171A1C]">
      {/* Background organic blur accents */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-[20%] -left-[10%] w-[500px] h-[500px] rounded-full bg-[#CBE855]/20 blur-[120px]" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[500px] h-[500px] rounded-full bg-[#0F172A]/10 blur-[120px]" />
      </div>

      <div className="w-full max-w-[490px]">
        {/* Brand header lockup */}
        <div className="flex flex-col items-center text-center mb-6 sm:mb-8">
          <div className="w-14 h-14 rounded-2xl bg-[#0F172A] text-white flex items-center justify-center shadow-lg shadow-black/10 mb-3 border border-white/20">
            <ShieldCheck className="w-8 h-8 text-[#CBE855]" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/80 border border-[#E2E6D5] text-[11px] font-semibold tracking-wider uppercase text-[#555C62] shadow-sm mb-2">
            <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
            Security Gateway Portal
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-[#0F172A]">
            MutasiPay <span className="text-[#059669]">2FA Portal</span>
          </h1>
          <p className="text-xs sm:text-sm text-[#555C62] mt-1 max-w-sm">
            Sistem pembayaran QRIS otomatis terproteksi otentikasi dua langkah via WhatsApp.
          </p>
        </div>

        {/* Card Shell */}
        <div className="bg-white rounded-[28px] sm:rounded-[32px] p-6 sm:p-8 shadow-bento-shell border border-[#E9ECE0]">
          {error && (
            <div className="mb-5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm flex items-start gap-2.5 animate-in fade-in slide-in-from-top-1">
              <ShieldAlert className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
              <div>
                <p className="font-semibold">Akses Ditolak</p>
                <p className="text-rose-600/90">{error}</p>
              </div>
            </div>
          )}

          {successMsg && phase === 'OTP' && (
            <div className="mb-5 p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm flex items-start gap-2.5 animate-in fade-in slide-in-from-top-1">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
              <div>
                <p className="font-semibold">Kode Terkirim</p>
                <p className="text-emerald-700">{successMsg}</p>
              </div>
            </div>
          )}

          {/* ================================================================ */}
          {/* PHASE 1: LOGIN (EMAIL & PASSWORD) */}
          {/* ================================================================ */}
          {phase === 'LOGIN' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#171A1C] uppercase tracking-wider mb-1.5">
                  Email Owner
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@domain.com"
                    className="w-full pl-10 pr-3.5 py-3 bg-[#F8F9F5] border border-[#E4E7DA] rounded-xl text-sm text-[#171A1C] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#CBE855] focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-[#171A1C] uppercase tracking-wider">
                    Password
                  </label>
                  <span className="text-[11px] text-[#6B7280]">Proteksi Enkripsi</span>
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-10 py-3 bg-[#F8F9F5] border border-[#E4E7DA] rounded-xl text-sm text-[#171A1C] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#CBE855] focus:border-transparent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-slate-900/10 hover:shadow-lg transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-[#CBE855]" />
                      <span>Memverifikasi Akun...</span>
                    </>
                  ) : (
                    <>
                      <span>Lanjut ke Verifikasi 2FA WhatsApp</span>
                      <ArrowRight className="w-4 h-4 text-[#CBE855]" />
                    </>
                  )}
                </button>
              </div>

              <div className="mt-4 pt-4 border-t border-[#F0F2E8] flex items-center justify-center gap-2 text-center text-[11px] text-[#64748B]">
                <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                <span>OTP 6 digit akan dikirim otomatis ke nomor WhatsApp terdaftar.</span>
              </div>
            </form>
          )}

          {/* ================================================================ */}
          {/* PHASE 2: OTP VERIFICATION (WHATSAPP 2FA) */}
          {/* ================================================================ */}
          {phase === 'OTP' && (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-2 border border-emerald-200">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-[#0F172A]">Otentikasi Dua Langkah (2FA)</h3>
                <p className="text-xs text-[#555C62] mt-1">
                  Masukkan 6 digit kode keamanan yang dikirim ke nomor WhatsApp Anda:
                </p>
                <div className="inline-block mt-1 px-2.5 py-0.5 rounded-lg bg-emerald-100/70 border border-emerald-300 font-mono font-bold text-xs text-emerald-900">
                  {whatsappMasked}
                </div>
              </div>

              {/* 6 Digit Input Boxes */}
              <div className="flex items-center justify-between gap-1.5 sm:gap-2 max-w-[340px] mx-auto py-1">
                {otpDigits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      otpInputsRef.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl sm:text-2xl font-black font-mono bg-[#F8F9F5] border-2 border-[#DCE1D0] rounded-xl focus:bg-white focus:border-[#0F172A] focus:ring-2 focus:ring-[#CBE855] focus:outline-none transition-all text-[#0F172A]"
                  />
                ))}
              </div>

              <div className="space-y-2.5">
                <button
                  type="submit"
                  disabled={loading || otpDigits.join('').length !== 6}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-slate-900/10 hover:shadow-lg transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-[#CBE855]" />
                      <span>Memverifikasi Kode OTP...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-[#CBE855]" />
                      <span>Verifikasi & Lanjut</span>
                    </>
                  )}
                </button>

                <div className="flex items-center justify-between pt-1 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setPhase('LOGIN');
                      setError(null);
                    }}
                    className="text-[#64748B] hover:text-[#0F172A] font-semibold underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    Ganti Password / Akun
                  </button>

                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={countdown > 0 || loading}
                    className="font-semibold text-emerald-700 hover:text-emerald-900 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {countdown > 0 ? `Kirim ulang (${countdown}s)` : 'Kirim Ulang Kode OTP'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* ================================================================ */}
          {/* PHASE 3: PORTAL AKSES MUTASIPAY (AFTER SUCCESSFUL VERIFICATION) */}
          {/* ================================================================ */}
          {phase === 'PORTAL' && (
            <div className="space-y-6 text-center animate-in fade-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-3xl bg-[#CBE855]/20 text-[#0F172A] flex items-center justify-center mx-auto border-2 border-[#CBE855] shadow-inner">
                <CheckCircle2 className="w-9 h-9 text-[#059669]" />
              </div>

              <div>
                <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 mb-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                  Otentikasi 2FA Berhasil
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-[#0F172A]">
                  Portal Akses MutasiPay
                </h2>
                <p className="text-xs sm:text-sm text-[#555C62] mt-1">
                  Identitas Anda telah terverifikasi aman melalui WhatsApp 2FA.
                </p>
              </div>

              {/* Owner Profile Badge Card */}
              <div className="p-4 rounded-2xl bg-[#F8F9F5] border border-[#E2E6D5] text-left flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#0F172A] text-white flex items-center justify-center font-bold text-sm shrink-0">
                    OW
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#0F172A] truncate">{email}</p>
                    <p className="text-[11px] text-[#64748B]">WhatsApp: 081230008293</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase shrink-0">
                  Owner
                </span>
              </div>

              {/* Main CTA: Masuk ke Aplikasi MutasiPay */}
              <button
                type="button"
                onClick={onLoginSuccess}
                className="w-full py-4 px-5 rounded-2xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-extrabold text-base flex items-center justify-between shadow-xl shadow-slate-900/15 hover:shadow-2xl transition-all group active:scale-[0.99] cursor-pointer"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="w-9 h-9 rounded-xl bg-[#CBE855] text-[#0F172A] flex items-center justify-center font-bold">
                    <Zap className="w-5 h-5 fill-current" />
                  </div>
                  <div>
                    <div className="text-sm font-black">Masuk ke Aplikasi MutasiPay</div>
                    <div className="text-[11px] text-slate-300 font-normal">
                      Buka dashboard kontrol & mutasi real-time
                    </div>
                  </div>
                </div>
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:translate-x-1 transition-transform">
                  <ArrowRight className="w-4 h-4 text-[#CBE855]" />
                </div>
              </button>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleLogoutFromPortal}
                  className="inline-flex items-center gap-1.5 text-xs text-[#64748B] hover:text-rose-600 transition-colors font-medium cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Keluar dari Sesi Portal</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Security watermark footer */}
        <div className="mt-6 text-center text-xs text-[#6B7280]">
          <p>© 2026 MutasiPay Cloudflare Gateway. Dilindungi 2FA WhatsApp.</p>
        </div>
      </div>
    </div>
  );
}
