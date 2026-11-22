import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Mail,
  MessageSquare,
  QrCode,
  Send,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { OrderStatus, QrisProvider } from '../types';
import { formatRupiah } from '../lib/qris';
import { copyTextToClipboard, formatCountdown, formatDateTime } from '../lib/format';

interface HostedPaymentPayload {
  payment: {
    id: string;
    orderCode: string;
    externalId: string | null;
    returnUrl: string | null;
    productName: string;
    buyerName: string;
    buyerEmail: string;
    buyerWhatsapp: string;
    baseAmount: number;
    uniqueCode: number;
    totalAmount: number;
    dynamicQris: string;
    status: OrderStatus;
    accessUrl: string | null;
    licenseKey: string | null;
    createdAt: string;
    expiresAt: string;
    paidAt: string | null;
    emailDeliveryStatus: string;
    whatsappDeliveryStatus: string;
  };
  channel: {
    id: string;
    label: string;
    provider: QrisProvider;
    providerName: string;
    packageName: string;
    merchantName: string;
    merchantCity: string;
    nmid: string;
  };
  qrDataUrl: string;
}

interface HostedPayViewProps {
  orderCode: string;
  onExitToDashboard: () => void;
}

export function HostedPayView({ orderCode, onExitToDashboard }: HostedPayViewProps) {
  const [data, setData] = useState<HostedPaymentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);

  const fetchPayment = useCallback(async () => {
    try {
      const res = await fetch(`/api/pay/${encodeURIComponent(orderCode)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Tagihan pembayaran tidak ditemukan.');
        setData(null);
        return;
      }
      setData(json as HostedPaymentPayload);
      setError(null);
    } catch {
      setError('Gagal terhubung ke server payment gateway.');
    } finally {
      setLoading(false);
    }
  }, [orderCode]);

  useEffect(() => {
    fetchPayment();

    const eventSource = new EventSource('/api/events');
    const handleRefresh = () => {
      fetchPayment();
    };
    eventSource.addEventListener('order_paid', handleRefresh);
    eventSource.addEventListener('snapshot', handleRefresh);

    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      eventSource.close();
      clearInterval(timer);
    };
  }, [fetchPayment]);

  async function handleCopy(key: string, value: string) {
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  async function handleSimulatePayment() {
    if (!data) return;
    setSimulating(true);
    try {
      const formattedNominal = new Intl.NumberFormat('id-ID').format(data.payment.totalAmount);
      const isNeo = data.channel.provider === 'NEOBANK';
      await fetch('/api/simulate/dana-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${data.channel.providerName} — Pembayaran QRIS`,
          message: isNeo
            ? `Anda menerima pembayaran QRIS sebesar Rp ${formattedNominal} dari ${data.payment.buyerName.toUpperCase()} di Neobank`
            : `Kamu baru saja menerima pembayaran Rp ${formattedNominal} melalui QRIS dari ${data.payment.buyerName.toUpperCase()}`,
          senderName: data.payment.buyerName.toUpperCase(),
          packageName: data.channel.packageName,
        }),
      });
      await fetchPayment();
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#EAEDE1] text-[#171A1C] py-4 px-3 sm:py-8 sm:px-6 flex items-center justify-center">
      <div className="w-full max-w-[940px] bg-white rounded-[30px] sm:rounded-[34px] shadow-bento-shell overflow-hidden">
        {/* Top Payment Gateway Header */}
        <header className="px-5 sm:px-8 py-4 border-b border-[#F2F3EE] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <svg width="32" height="32" viewBox="0 0 36 36" fill="none" aria-hidden="true">
              <circle cx="18" cy="11.5" r="6" stroke="#E5B6F7" strokeWidth="2.4" fill="#FBF0FF" />
              <circle cx="12" cy="22" r="6.2" stroke="#CBE855" strokeWidth="2.4" fill="#F7FDE4" />
              <circle cx="24" cy="22" r="6.2" stroke="#F1B8F8" strokeWidth="2.4" fill="#FFF2FE" />
            </svg>
            <div>
              <span className="font-display text-base font-bold tracking-tight text-[#171A1C] inline-flex items-center">
                <span>Mutasi</span>
                <span className="ml-0.5 px-2 py-0.5 rounded-full bg-pastel-cta text-[#171A1C] font-bold">
                  Pay
                </span>
              </span>
              <p className="text-[11px] text-[#6B727B]">QRIS Payment Gateway</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {data && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#F6F7F4] text-xs font-semibold text-[#171A1C]">
                <Wallet className="w-3.5 h-3.5 text-[#5B7A16]" />
                {data.channel.providerName}
              </span>
            )}
            <button
              type="button"
              onClick={onExitToDashboard}
              className="px-3.5 py-1.5 rounded-full bg-[#F6F7F4] hover:bg-[#ECEEE6] text-xs font-semibold text-[#4B525A] hover:text-[#171A1C] inline-flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Dashboard
            </button>
          </div>
        </header>

        <main className="p-5 sm:p-8">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              <div className="md:col-span-6 h-80 bg-[#F6F7F4] rounded-[28px] animate-pulse" />
              <div className="md:col-span-6 h-80 bg-[#F6F7F4] rounded-[28px] animate-pulse" />
            </div>
          ) : error || !data ? (
            <div className="bg-[#FAFBF8] border border-[#ECEEE6] rounded-[28px] p-10 text-center space-y-3">
              <p className="font-display text-lg font-bold text-[#171A1C]">
                Tagihan Tidak Ditemukan
              </p>
              <p className="text-xs text-[#6B727B] max-w-md mx-auto">
                {error || `Kode pembayaran "${orderCode}" tidak ditemukan atau sudah tidak berlaku.`}
              </p>
              <button
                type="button"
                onClick={onExitToDashboard}
                className="px-5 py-2.5 rounded-full bg-pastel-cta text-xs font-bold text-[#171A1C]"
              >
                Kembali ke Beranda
              </button>
            </div>
          ) : data.payment.status === 'PAID' ? (
            /* PAID STATE */
            <div className="space-y-5">
              <section className="bg-pastel-lime rounded-[28px] p-6 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shrink-0 shadow-xs">
                    <CheckCircle2 className="w-6 h-6 text-[#3C6E14]" />
                  </div>
                  <div>
                    <p className="text-xs font-mono font-semibold text-[#2E430D]">
                      {data.payment.orderCode} · Lunas {formatDateTime(data.payment.paidAt)}
                    </p>
                    <h1 className="font-display text-xl sm:text-2xl font-bold text-[#171A1C] mt-0.5">
                      Pembayaran QRIS Terverifikasi
                    </h1>
                    <p className="text-xs sm:text-sm text-[#2F3E10] mt-1">
                      Pembayaran{' '}
                      <strong className="font-mono tabular-nums">
                        {formatRupiah(data.payment.totalAmount)}
                      </strong>{' '}
                      via {data.channel.providerName} ({data.channel.merchantName}) telah diterima otomatis.
                    </p>
                  </div>
                </div>

                {data.payment.returnUrl && (
                  <a
                    href={data.payment.returnUrl}
                    className="px-5 py-3 rounded-full bg-[#171A1C] hover:bg-[#2B3035] text-xs font-semibold text-[#D8F36A] inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                  >
                    Kembali ke Aplikasi
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </section>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                <section className="md:col-span-7 bg-[#FAFBF8] border border-[#ECEEE6] rounded-[26px] p-6 space-y-4">
                  <div>
                    <p className="text-xs text-[#6B727B]">Produk Digital Anda</p>
                    <h2 className="font-display text-base font-bold text-[#171A1C] mt-0.5">
                      {data.payment.productName}
                    </h2>
                  </div>

                  {data.payment.licenseKey && (
                    <div className="p-4 rounded-2xl bg-white border border-[#ECEEE6] flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-[#6B727B]">Kunci Lisensi / Kode Akses</p>
                        <p className="font-mono text-sm font-bold text-[#171A1C] mt-0.5 truncate">
                          {data.payment.licenseKey}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy('license', data.payment.licenseKey ?? '')}
                        className="px-3.5 py-1.5 rounded-full bg-[#F5F6F2] hover:bg-[#E7F4B5] text-xs font-semibold text-[#171A1C] shrink-0"
                      >
                        {copiedKey === 'license' ? 'Disalin' : 'Salin'}
                      </button>
                    </div>
                  )}

                  {data.payment.accessUrl && (
                    <a
                      href={data.payment.accessUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-3.5 px-5 rounded-full bg-pastel-cta text-sm font-display font-bold text-[#171A1C] inline-flex items-center justify-center gap-2 shadow-xs"
                    >
                      Buka Akses Produk Digital
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </section>

                <section className="md:col-span-5 bg-white border border-[#ECEEE6] rounded-[26px] p-6 space-y-3 text-xs">
                  <h3 className="font-display text-sm font-bold text-[#171A1C]">
                    Status Pengiriman Otomatis
                  </h3>
                  <div className="p-3.5 rounded-2xl bg-[#F6F7F4] flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 font-semibold text-[#171A1C]">
                      <Mail className="w-4 h-4 text-[#7E2FA0]" />
                      Email
                    </span>
                    <span className="text-[#3C6E14] font-semibold">
                      {data.payment.emailDeliveryStatus === 'SENT' ? 'Terkirim' : 'Terkirim (Pratinjau)'}
                    </span>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-[#F6F7F4] flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 font-semibold text-[#171A1C]">
                      <MessageSquare className="w-4 h-4 text-[#3C6E14]" />
                      WhatsApp
                    </span>
                    <span className="text-[#3C6E14] font-semibold">
                      {data.payment.whatsappDeliveryStatus === 'SENT'
                        ? 'Terkirim'
                        : 'Terkirim (Pratinjau)'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#6B727B] pt-1">
                    Salinan akses juga telah dikirim ke <strong>{data.payment.buyerEmail}</strong> dan{' '}
                    <span className="font-mono">+{data.payment.buyerWhatsapp}</span>.
                  </p>
                </section>
              </div>
            </div>
          ) : (
            /* PENDING / EXPIRED STATE */
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              {/* Left QRIS Card */}
              <section className="md:col-span-6 bg-pastel-hero rounded-[28px] p-6 text-center space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="px-3 py-1 rounded-full bg-white/80 font-display font-bold text-[#171A1C]">
                    {data.channel.providerName}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-white/85 font-mono font-semibold text-[#B45309] inline-flex items-center gap-1 tabular-nums">
                    <Clock className="w-3.5 h-3.5" />
                    {data.payment.status === 'EXPIRED'
                      ? 'Kedaluwarsa'
                      : formatCountdown(data.payment.expiresAt, nowMs)}
                  </span>
                </div>

                <div>
                  <h1 className="font-display text-base font-bold text-[#171A1C]">
                    {data.channel.merchantName}
                  </h1>
                  <p className="text-xs text-[#4C3257] font-mono mt-0.5">
                    NMID {data.channel.nmid} · {data.channel.merchantCity}
                  </p>
                </div>

                <div className="flex justify-center">
                  <img
                    src={data.qrDataUrl}
                    alt={`QRIS Dinamis ${data.payment.orderCode}`}
                    className="w-64 h-64 rounded-[24px] bg-white p-2.5 shadow-sm"
                  />
                </div>

                <div className="bg-white/95 rounded-[22px] p-4 space-y-1">
                  <p className="text-xs text-[#6B727B]">Total Tagihan QRIS (Otomatis Terisi)</p>
                  <div className="flex items-center justify-center gap-2">
                    <p className="text-2xl font-bold text-[#171A1C] font-mono tabular-nums">
                      {formatRupiah(data.payment.totalAmount)}
                    </p>
                    <button
                      type="button"
                      aria-label="Salin nominal"
                      onClick={() => handleCopy('amount', String(data.payment.totalAmount))}
                      className="w-8 h-8 rounded-full bg-[#F5F6F2] hover:bg-[#E7F4B5] text-[#4B525A] hover:text-[#171A1C] flex items-center justify-center transition-colors"
                    >
                      {copiedKey === 'amount' ? (
                        <Check className="w-4 h-4 text-[#3C6E14]" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-[#6B727B] font-mono tabular-nums">
                    Harga {formatRupiah(data.payment.baseAmount)} + Kode unik {data.payment.uniqueCode}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleCopy('qris', data.payment.dynamicQris)}
                  className="text-xs font-semibold text-[#3C2446] hover:text-[#171A1C] inline-flex items-center gap-1.5"
                >
                  {copiedKey === 'qris' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#3C6E14]" />
                      String QRIS Disalin
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Salin Payload QRIS Dinamis
                    </>
                  )}
                </button>
              </section>

              {/* Right Invoice & Instructions */}
              <section className="md:col-span-6 space-y-4">
                <div className="bg-[#FAFBF8] border border-[#ECEEE6] rounded-[26px] p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-pastel-lime flex items-center justify-center shrink-0">
                      <QrCode className="w-5 h-5 text-[#171A1C]" />
                    </div>
                    <div>
                      <h2 className="font-display text-base font-bold text-[#171A1C]">
                        Selesaikan Pembayaran QRIS
                      </h2>
                      <p className="text-xs text-[#5E656E] mt-1 leading-relaxed">
                        Scan kode QRIS di samping menggunakan aplikasi e-wallet (DANA, GoPay, OVO, ShopeePay) atau Mobile Banking (Neobank, BCA, BRI, Mandiri, BNI). Status terverifikasi otomatis real-time.
                      </p>
                    </div>
                  </div>

                  <dl className="divide-y divide-[#ECEEE6] text-xs">
                    <div className="py-2.5 flex justify-between gap-4">
                      <dt className="text-[#6B727B]">Kode Invoice</dt>
                      <dd className="font-mono font-bold text-[#171A1C]">{data.payment.orderCode}</dd>
                    </div>
                    {data.payment.externalId && (
                      <div className="py-2.5 flex justify-between gap-4">
                        <dt className="text-[#6B727B]">ID Aplikasi</dt>
                        <dd className="font-mono text-[#4B525A]">{data.payment.externalId}</dd>
                      </div>
                    )}
                    <div className="py-2.5 flex justify-between gap-4">
                      <dt className="text-[#6B727B]">Produk / Item</dt>
                      <dd className="font-semibold text-[#171A1C] text-right">
                        {data.payment.productName}
                      </dd>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <dt className="text-[#6B727B]">Channel Penerima</dt>
                      <dd className="font-semibold text-[#171A1C] text-right">
                        {data.channel.label} ({data.channel.providerName})
                      </dd>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <dt className="text-[#6B727B]">Pembeli</dt>
                      <dd className="text-[#4B525A] text-right">{data.payment.buyerName}</dd>
                    </div>
                    <div className="py-2.5 flex justify-between gap-4">
                      <dt className="text-[#6B727B]">Pengiriman Akses</dt>
                      <dd className="text-[#4B525A] text-right truncate max-w-[200px]">
                        {data.payment.buyerEmail}
                      </dd>
                    </div>
                  </dl>
                </div>

                {data.payment.status === 'PENDING' && (
                  <div className="bg-pastel-lime rounded-[24px] p-5 space-y-2.5">
                    <p className="font-display text-xs font-bold text-[#171A1C]">
                      Simulasi Verifikasi Mutasi ({data.channel.providerName})
                    </p>
                    <p className="text-[11px] text-[#2F3E10] leading-relaxed">
                      Khusus uji coba pemilik toko: picu mutasi masuk Rp{' '}
                      <span className="font-mono font-bold tabular-nums">
                        {new Intl.NumberFormat('id-ID').format(data.payment.totalAmount)}
                      </span>{' '}
                      untuk melihat halaman pembayaran ini langsung terbuka real-time.
                    </p>
                    <button
                      type="button"
                      disabled={simulating}
                      onClick={handleSimulatePayment}
                      className="w-full py-2.5 px-4 rounded-full bg-[#171A1C] hover:bg-[#2B3035] disabled:opacity-50 text-xs font-semibold text-[#D8F36A] inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {simulating ? 'Memverifikasi Pembayaran...' : 'Simulasikan Bayar QRIS Masuk'}
                    </button>
                  </div>
                )}

                <p className="text-[11px] text-[#6B727B] flex items-center justify-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#3C6E14]" />
                  Verifikasi mutasi otomatis · Hosted Payment Page MutasiPay
                </p>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
