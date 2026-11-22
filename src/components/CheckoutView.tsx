import { useEffect, useState, type FormEvent } from 'react';
import {
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
} from 'lucide-react';
import type { DashboardSnapshot, OrderRecord } from '../types';
import { formatRupiah, parseQrisMetadata } from '../lib/qris';
import { resolveActiveChannel } from '../lib/qrisChannels';
import { copyTextToClipboard, formatCountdown, formatDateTime } from '../lib/format';

interface CheckoutViewProps {
  snapshot: DashboardSnapshot;
  initialProductId: string | null;
  onOrderCreated: () => Promise<void>;
  onSimulateOrderPayment: (order: OrderRecord) => Promise<void>;
  simulatingId: string | null;
}

export function CheckoutView({
  snapshot,
  initialProductId,
  onOrderCreated,
  onSimulateOrderPayment,
  simulatingId,
}: CheckoutViewProps) {
  const activeProducts = snapshot.products.filter((p) => p.active);
  const [selectedProductId, setSelectedProductId] = useState<string>(
    initialProductId || activeProducts[0]?.id || ''
  );
  const [selectedChannelId, setSelectedChannelId] = useState<string>(
    snapshot.settings.activeQrisChannelId
  );
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerWhatsapp, setBuyerWhatsapp] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (initialProductId && activeProducts.some((p) => p.id === initialProductId)) {
      setSelectedProductId(initialProductId);
    } else if (!selectedProductId && activeProducts[0]) {
      setSelectedProductId(activeProducts[0].id);
    }
  }, [initialProductId, activeProducts.length]);

  useEffect(() => {
    if (!activeOrderId) {
      setSelectedChannelId(snapshot.settings.activeQrisChannelId);
    }
  }, [snapshot.settings.activeQrisChannelId, activeOrderId]);

  useEffect(() => {
    if (!activeOrderId) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeOrderId]);

  const selectedProduct = activeProducts.find((p) => p.id === selectedProductId) ?? activeProducts[0];
  const activeOrder = activeOrderId
    ? snapshot.orders.find((o) => o.id === activeOrderId) ?? null
    : null;
  const selectedChannel = resolveActiveChannel(
    snapshot.qrisChannels,
    activeOrder?.qrisChannelId ?? selectedChannelId,
    snapshot.settings.activeQrisChannelId
  );
  const merchantMeta = parseQrisMetadata(selectedChannel.staticQris);

  async function handleCheckoutSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!selectedProduct) {
      setFormError('Pilih produk digital terlebih dahulu.');
      return;
    }
    if (!buyerName.trim() || buyerName.trim().length < 2) {
      setFormError('Nama lengkap pembeli wajib diisi.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail.trim())) {
      setFormError('Masukkan alamat email aktif yang valid.');
      return;
    }
    const cleanPhone = buyerWhatsapp.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setFormError('Masukkan nomor WhatsApp aktif (contoh: 081234567890).');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: selectedProduct.id,
          qrisChannelId: selectedChannel.id,
          buyerName: buyerName.trim(),
          buyerEmail: buyerEmail.trim(),
          buyerWhatsapp: buyerWhatsapp.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Gagal membuat tagihan QRIS.');
        return;
      }

      setActiveOrderId(data.order.id);
      setQrDataUrl(data.qrDataUrl);
      await onOrderCreated();
    } catch {
      setFormError('Gagal terhubung ke server pembayaran.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy(key: string, value: string) {
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  function resetCheckout() {
    setActiveOrderId(null);
    setQrDataUrl(null);
    setBuyerName('');
    setBuyerEmail('');
    setBuyerWhatsapp('');
    setFormError(null);
  }

  // STATE 3: Payment Verified & Digital Product Unlocked in Real-Time
  if (activeOrder && activeOrder.status === 'PAID') {
    return (
      <div className="max-w-3xl mx-auto bg-white border border-[#ECEEE6] rounded-[30px] overflow-hidden">
        <div className="px-6 py-6 sm:px-8 bg-pastel-lime">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shrink-0 shadow-2xs">
              <CheckCircle2 className="w-5 h-5 text-[#3C6E14]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[#2E430D] font-mono">
                {activeOrder.orderCode} · Terverifikasi {formatDateTime(activeOrder.paidAt)}
              </p>
              <h2 className="font-display text-xl font-bold text-[#171A1C] mt-1">
                Pembayaran QRIS Diterima — Akses Produk Terbuka
              </h2>
              <p className="text-sm text-[#2F3E10] mt-1">
                Mutasi sebesar{' '}
                <strong className="font-mono tabular-nums">
                  {formatRupiah(activeOrder.totalAmount)}
                </strong>{' '}
                telah diverifikasi otomatis oleh sistem {selectedChannel.providerName} {merchantMeta.merchantName}.
              </p>
            </div>
          </div>
        </div>

        <div className="divide-y divide-[#F2F3EE]">
          <div className="p-6 sm:px-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-[#6B727B]">Produk Digital Anda</p>
              <h3 className="font-display text-base font-bold text-[#171A1C] mt-0.5">
                {activeOrder.productName}
              </h3>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-[#6B727B]">Kunci Lisensi:</span>
                <code className="font-mono font-bold text-[#171A1C]">
                  {activeOrder.licenseKey}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy('license', activeOrder.licenseKey)}
                  className="text-[#7E2FA0] font-semibold hover:underline inline-flex items-center gap-1"
                >
                  {copiedKey === 'license' ? 'Disalin' : 'Salin'}
                </button>
              </div>
            </div>

            <a
              href={activeOrder.accessUrl}
              target="_blank"
              rel="noreferrer"
              className="px-5 py-2.5 text-sm font-semibold text-[#171A1C] bg-pastel-cta rounded-full transition-all inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              Buka Akses Produk
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[#F2F3EE]">
            <div className="p-6 sm:px-8 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#171A1C] inline-flex items-center gap-1.5">
                  <Mail className="w-4 h-4 text-[#7E2FA0]" />
                  Pengiriman Email
                </span>
                <span className="text-[#3C6E14] font-semibold">
                  {activeOrder.emailDelivery.status === 'SENT' ? 'Terkirim' : 'Terkirim (Pratinjau)'}
                </span>
              </div>
              <p className="text-xs text-[#6B727B]">{activeOrder.buyerEmail}</p>
              <pre className="text-[11px] text-[#4B525A] bg-[#F6F7F4] p-3.5 rounded-2xl whitespace-pre-wrap font-sans max-h-40 overflow-y-auto leading-relaxed">
                {activeOrder.emailDelivery.messagePreview}
              </pre>
            </div>

            <div className="p-6 sm:px-8 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[#171A1C] inline-flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-[#3C6E14]" />
                  Pengiriman WhatsApp
                </span>
                <span className="text-[#3C6E14] font-semibold">
                  {activeOrder.whatsappDelivery.status === 'SENT'
                    ? 'Terkirim'
                    : 'Terkirim (Pratinjau)'}
                </span>
              </div>
              <p className="text-xs font-mono text-[#6B727B]">+{activeOrder.buyerWhatsapp}</p>
              <pre className="text-[11px] text-[#4B525A] bg-[#F6F7F4] p-3.5 rounded-2xl whitespace-pre-wrap font-sans max-h-40 overflow-y-auto leading-relaxed">
                {activeOrder.whatsappDelivery.messagePreview}
              </pre>
            </div>
          </div>

          <div className="px-6 py-4 sm:px-8 flex justify-end bg-[#FAFBF8]">
            <button
              type="button"
              onClick={resetCheckout}
              className="px-5 py-2 text-xs font-semibold text-[#171A1C] bg-white border border-[#ECEEE6] hover:border-[#CBE855] rounded-full transition-colors"
            >
              Buat Pesanan Baru
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STATE 2: Dynamic QRIS Generated & Awaiting Real-Time Mutation Match
  if (activeOrder) {
    const hostedPayUrl = `${window.location.origin}/?pay=${encodeURIComponent(activeOrder.orderCode)}`;
    return (
      <div className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <section className="lg:col-span-6 bg-pastel-hero rounded-[30px] p-6 text-center space-y-4">
          <div className="flex items-center justify-between text-xs pb-2">
            <span className="font-display font-bold text-[#171A1C]">
              QRIS {selectedChannel.providerName} Dinamis
            </span>
            <span className="px-3 py-1 rounded-full bg-white/80 font-mono font-semibold text-[#B45309] inline-flex items-center gap-1 tabular-nums">
              <Clock className="w-3.5 h-3.5" />
              {formatCountdown(activeOrder.expiresAt, nowMs)}
            </span>
          </div>

          <div>
            <p className="font-display text-sm font-bold text-[#171A1C]">
              {merchantMeta.merchantName}
            </p>
            <p className="text-xs text-[#4C3257] font-mono mt-0.5">
              NMID {merchantMeta.nmid} · {merchantMeta.merchantCity}
            </p>
          </div>

          <div className="flex justify-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`Kode QRIS Dinamis untuk ${activeOrder.orderCode}`}
                className="w-60 h-60 rounded-[24px] bg-white p-2 shadow-sm"
              />
            ) : (
              <div className="w-60 h-60 bg-white/70 rounded-[24px] flex items-center justify-center text-xs text-[#6B727B]">
                Memuat QRIS...
              </div>
            )}
          </div>

          <div className="bg-white/90 rounded-[22px] p-4 space-y-1">
            <p className="text-xs text-[#6B727B]">Total Bayar Persis (Nominal Otomatis di QRIS)</p>
            <div className="flex items-center justify-center gap-2">
              <p className="text-2xl font-bold text-[#171A1C] font-mono tabular-nums">
                {formatRupiah(activeOrder.totalAmount)}
              </p>
              <button
                type="button"
                aria-label="Salin nominal pembayaran"
                onClick={() => handleCopy('amount', String(activeOrder.totalAmount))}
                className="w-8 h-8 rounded-full bg-[#F5F6F2] text-[#4B525A] hover:text-[#171A1C] hover:bg-[#E7F4B5] flex items-center justify-center transition-colors"
              >
                {copiedKey === 'amount' ? (
                  <Check className="w-4 h-4 text-[#3C6E14]" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-xs text-[#6B727B] font-mono tabular-nums">
              Harga {formatRupiah(activeOrder.baseAmount)} + Kode unik {activeOrder.uniqueCode}
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 text-xs pt-1">
            <button
              type="button"
              onClick={() => handleCopy('qris', activeOrder.dynamicQris)}
              className="text-[#3C2446] hover:text-[#171A1C] font-medium inline-flex items-center gap-1"
            >
              {copiedKey === 'qris' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#3C6E14]" />
                  String QRIS Disalin
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Salin String QRIS
                </>
              )}
            </button>
            <span className="text-[#3C2446]/30" aria-hidden="true">·</span>
            <button
              type="button"
              onClick={resetCheckout}
              className="text-[#3C2446]/80 hover:text-[#171A1C] font-medium"
            >
              Ganti Produk
            </button>
          </div>
        </section>

        <section className="lg:col-span-6 space-y-5">
          <div className="bg-white border border-[#ECEEE6] rounded-[28px] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-pastel-lime flex items-center justify-center shrink-0">
                <QrCode className="w-5 h-5 text-[#171A1C]" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-[#171A1C]">
                  Menunggu Konfirmasi Mutasi {selectedChannel.providerName}
                </h2>
                <p className="text-xs text-[#5E656E] mt-1 leading-relaxed">
                  Scan QRIS di samping menggunakan DANA, Neobank, GoPay, OVO, ShopeePay, atau Mobile Banking. Halaman ini terhubung real-time dan langsung membuka akses produk serta mengirimkannya ke Email & WhatsApp Anda.
                </p>
              </div>
            </div>

            <dl className="divide-y divide-[#F2F3EE] text-xs pt-1">
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#6B727B]">Kode Pesanan</dt>
                <dd className="font-mono font-semibold text-[#171A1C]">{activeOrder.orderCode}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#6B727B]">Channel QRIS</dt>
                <dd className="font-semibold text-[#171A1C] text-right">
                  {selectedChannel.label} ({selectedChannel.providerName})
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#6B727B]">Produk Digital</dt>
                <dd className="font-semibold text-[#171A1C] text-right">
                  {activeOrder.productName}
                </dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#6B727B]">Tujuan Email</dt>
                <dd className="text-[#4B525A]">{activeOrder.buyerEmail}</dd>
              </div>
              <div className="py-2.5 flex justify-between gap-4">
                <dt className="text-[#6B727B]">Tujuan WhatsApp</dt>
                <dd className="font-mono text-[#4B525A]">+{activeOrder.buyerWhatsapp}</dd>
              </div>
            </dl>

            {/* Hosted Payment Page Share Box (Midtrans / Duitku / Xendit style) */}
            <div className="p-3.5 rounded-2xl bg-[#F6F7F4] space-y-2">
              <p className="text-[11px] font-semibold text-[#3C424A]">
                Hosted Payment Page URL (Siap Dibagikan / Redirect dari Aplikasi Lain)
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono text-[#171A1C] truncate">
                  {hostedPayUrl}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy('hostedUrl', hostedPayUrl)}
                  className="px-3 py-1 rounded-full bg-white border border-[#ECEEE6] hover:border-[#CBE855] text-[11px] font-semibold text-[#171A1C] whitespace-nowrap shrink-0"
                >
                  {copiedKey === 'hostedUrl' ? 'Disalin' : 'Salin Link'}
                </button>
                <a
                  href={hostedPayUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1 rounded-full bg-[#171A1C] text-[#D8F36A] text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  Buka
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>

          <div className="bg-pastel-lime rounded-[28px] p-6 space-y-3">
            <h3 className="font-display text-sm font-bold text-[#171A1C]">
              Uji Verifikasi Mutasi Real-Time (Khusus Pemilik Toko)
            </h3>
            <p className="text-xs text-[#2F3E10] leading-relaxed">
              Klik tombol di bawah untuk memicu notifikasi webhook {selectedChannel.providerName} masuk sebesar{' '}
              <span className="font-mono font-bold text-[#171A1C] tabular-nums">
                {formatRupiah(activeOrder.totalAmount)}
              </span>{' '}
              dan lihat halaman ini otomatis terverifikasi tanpa memuat ulang.
            </p>
            <button
              type="button"
              disabled={simulatingId === activeOrder.id}
              onClick={() => onSimulateOrderPayment(activeOrder)}
              className="w-full px-5 py-3 text-sm font-semibold text-[#D8F36A] bg-[#171A1C] hover:bg-[#2B3035] disabled:opacity-50 rounded-full transition-colors inline-flex items-center justify-center gap-2"
            >
              <Send className="w-4 h-4" />
              {simulatingId === activeOrder.id
                ? 'Memverifikasi Mutasi & Mengirim Akses...'
                : `Simulasikan Mutasi ${selectedChannel.providerName} Masuk`}
            </button>
          </div>
        </section>
      </div>
    );
  }

  // STATE 1: Buyer Product Selection & Checkout Form
  return (
    <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <section className="lg:col-span-7 bg-white border border-[#ECEEE6] rounded-[28px] p-6 space-y-4">
        <div>
          <h2 className="font-display text-base font-bold text-[#171A1C]">Pilih Produk Digital</h2>
          <p className="text-xs text-[#6B727B] mt-0.5">
            Pembayaran QRIS ke {merchantMeta.merchantName} — akses produk dikirim otomatis ke Email & WhatsApp.
          </p>
        </div>

        <div className="space-y-3" role="radiogroup" aria-label="Pilih produk digital">
          {activeProducts.map((product) => {
            const isSelected = selectedProduct?.id === product.id;
            return (
              <button
                key={product.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelectedProductId(product.id)}
                className={`w-full text-left p-4 rounded-[22px] border transition-all relative overflow-hidden ${
                  isSelected
                    ? 'border-[#CBE855] bg-[#F8FDE8]'
                    : 'border-transparent bg-[#F6F7F4] hover:bg-[#F0F2EB]'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#6B727B]">
                      {product.category} · {product.fileInfo}
                    </p>
                    <p className="font-display text-sm font-bold text-[#171A1C] mt-0.5">
                      {product.name}
                    </p>
                    <p className="text-xs text-[#5E656E] mt-1 line-clamp-2">{product.description}</p>
                  </div>
                  <p className="px-3 py-1 rounded-full bg-white text-xs font-bold text-[#171A1C] font-mono tabular-nums whitespace-nowrap shrink-0 shadow-2xs">
                    {formatRupiah(product.price)}
                  </p>
                </div>
                {isSelected && (
                  <div
                    aria-hidden="true"
                    className="absolute bottom-0 left-4 right-4 h-[3px] rounded-full bg-pastel-bar"
                  />
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="lg:col-span-5 bg-white border border-[#ECEEE6] rounded-[28px] p-6">
        <h2 className="font-display text-base font-bold text-[#171A1C]">
          Data Penerima Akses Produk
        </h2>
        <p className="text-xs text-[#6B727B] mt-0.5">
          Link unduhan dan lisensi dikirim otomatis ke Email & WhatsApp berikut setelah pembayaran QRIS terverifikasi.
        </p>

        <form onSubmit={handleCheckoutSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="checkout-name"
              className="block text-xs font-semibold text-[#3C424A] mb-1.5"
            >
              Nama Lengkap
            </label>
            <input
              id="checkout-name"
              type="text"
              value={buyerName}
              onChange={(e) => setBuyerName(e.target.value)}
              placeholder="Contoh: Andi Wijaya"
              className="w-full px-4 py-2.5 text-sm bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] placeholder:text-[#8A929C] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label
              htmlFor="checkout-email"
              className="block text-xs font-semibold text-[#3C424A] mb-1.5"
            >
              Alamat Email Aktif
            </label>
            <input
              id="checkout-email"
              type="email"
              value={buyerEmail}
              onChange={(e) => setBuyerEmail(e.target.value)}
              placeholder="andi@email.com"
              className="w-full px-4 py-2.5 text-sm bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] placeholder:text-[#8A929C] focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label
              htmlFor="checkout-wa"
              className="block text-xs font-semibold text-[#3C424A] mb-1.5"
            >
              Nomor WhatsApp Aktif
            </label>
            <input
              id="checkout-wa"
              type="tel"
              value={buyerWhatsapp}
              onChange={(e) => setBuyerWhatsapp(e.target.value)}
              placeholder="081234567890"
              className="w-full px-4 py-2.5 text-sm font-mono bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] placeholder:text-[#8A929C] focus:outline-none transition-colors"
            />
          </div>

          {/* Multi-QRIS Channel Selector */}
          <div>
            <label
              htmlFor="checkout-qris-channel"
              className="block text-xs font-semibold text-[#3C424A] mb-1.5"
            >
              Channel QRIS Penerima
            </label>
            {snapshot.qrisChannels.length > 1 ? (
              <select
                id="checkout-qris-channel"
                value={selectedChannel.id}
                onChange={(e) => setSelectedChannelId(e.target.value)}
                className="w-full px-4 py-2.5 text-xs font-semibold bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              >
                {snapshot.qrisChannels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.label} ({ch.providerName} · {ch.merchantName})
                  </option>
                ))}
              </select>
            ) : (
              <div className="px-4 py-2.5 rounded-2xl bg-[#F6F7F4] text-xs font-semibold text-[#171A1C] flex items-center justify-between">
                <span>
                  {selectedChannel.label} ({selectedChannel.providerName})
                </span>
                <span className="font-mono text-[11px] text-[#5E656E]">
                  {selectedChannel.merchantName}
                </span>
              </div>
            )}
          </div>

          {selectedProduct && (
            <div className="pt-3 border-t border-[#F2F3EE] space-y-1.5 text-xs">
              <div className="flex justify-between text-[#5E656E]">
                <span>Harga Produk</span>
                <span className="font-mono tabular-nums">{formatRupiah(selectedProduct.price)}</span>
              </div>
              <div className="flex justify-between text-[#5E656E]">
                <span>Kode Unik Verifikasi</span>
                <span className="font-mono text-[#7D858E]">Otomatis (+101 s/d +999)</span>
              </div>
              <div className="flex justify-between text-[#171A1C] font-bold pt-1.5 border-t border-[#F2F3EE]">
                <span>Metode Pembayaran</span>
                <span>QRIS Dinamis ({selectedChannel.providerName})</span>
              </div>
            </div>
          )}

          {formError && (
            <p role="alert" className="text-xs font-semibold text-[#C83E2B]">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !selectedProduct}
            className="w-full px-5 py-3.5 text-sm font-display font-bold text-[#171A1C] bg-pastel-cta disabled:opacity-50 rounded-full transition-all shadow-xs"
          >
            {submitting ? 'Membuat QRIS Dinamis...' : 'Buat QRIS Pembayaran'}
          </button>

          <p className="text-[11px] text-[#6B727B] flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#3C6E14] shrink-0" />
            Verifikasi mutasi otomatis 24 jam · Akses langsung terkirim
          </p>
        </form>
      </section>
    </div>
  );
}
