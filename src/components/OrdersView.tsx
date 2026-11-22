import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  X,
} from 'lucide-react';
import type { DashboardSnapshot, OrderRecord, OrderStatus } from '../types';
import { formatRupiah } from '../lib/qris';
import { copyTextToClipboard, formatDateTime } from '../lib/format';

interface OrdersViewProps {
  snapshot: DashboardSnapshot;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string | null) => void;
  onRefresh: () => Promise<void>;
  onSimulateOrderPayment: (order: OrderRecord) => Promise<void>;
  simulatingId: string | null;
}

export function OrdersView({
  snapshot,
  selectedOrderId,
  onSelectOrder,
  onRefresh,
  onSimulateOrderPayment,
  simulatingId,
}: OrdersViewProps) {
  const [filter, setFilter] = useState<'ALL' | OrderStatus>('ALL');
  const [query, setQuery] = useState('');
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendNote, setResendNote] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);

  const selectedOrder = snapshot.orders.find((o) => o.id === selectedOrderId) ?? null;

  useEffect(() => {
    setResendNote(null);
    if (!selectedOrder) {
      setQrImageUrl(null);
      return;
    }
    let active = true;
    fetch('/api/qris/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qris: selectedOrder.dynamicQris }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (active && d.dataUrl) setQrImageUrl(d.dataUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedOrder?.id, selectedOrder?.dynamicQris]);

  const filteredOrders = snapshot.orders.filter((order) => {
    if (filter !== 'ALL' && order.status !== filter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        order.orderCode.toLowerCase().includes(q) ||
        order.buyerName.toLowerCase().includes(q) ||
        order.buyerEmail.toLowerCase().includes(q) ||
        order.buyerWhatsapp.includes(q) ||
        order.productName.toLowerCase().includes(q) ||
        String(order.totalAmount).includes(q)
      );
    }
    return true;
  });

  async function handleResend(orderId: string) {
    setResendingId(orderId);
    setResendNote(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/resend`, { method: 'POST' });
      if (res.ok) {
        setResendNote('Akses produk berhasil dikirim ulang ke Email dan WhatsApp pembeli.');
        await onRefresh();
      } else {
        const d = await res.json();
        setResendNote(d.error || 'Gagal mengirim ulang akses.');
      }
    } finally {
      setResendingId(null);
    }
  }

  async function handleCopy(label: string, value: string) {
    const ok = await copyTextToClipboard(value);
    if (ok) {
      setCopiedKey(label);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* Orders Table */}
      <section
        className={`${
          selectedOrder ? 'xl:col-span-7' : 'xl:col-span-12'
        } bg-white border border-[#ECEEE6] rounded-[28px] overflow-hidden`}
      >
        <div className="px-6 py-4 border-b border-[#F2F3EE] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div
            className="flex items-center gap-1.5 p-1 bg-[#F5F6F2] rounded-full w-fit overflow-x-auto"
            role="tablist"
            aria-label="Filter status pesanan"
          >
            {(
              [
                { id: 'ALL', label: `Semua (${snapshot.orders.length})` },
                {
                  id: 'PENDING',
                  label: `Menunggu (${snapshot.orders.filter((o) => o.status === 'PENDING').length})`,
                },
                {
                  id: 'PAID',
                  label: `Terverifikasi (${snapshot.orders.filter((o) => o.status === 'PAID').length})`,
                },
                {
                  id: 'EXPIRED',
                  label: `Kedaluwarsa (${snapshot.orders.filter((o) => o.status === 'EXPIRED').length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition-all whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-white border border-[#CBE855] text-[#171A1C] font-semibold shadow-2xs'
                    : 'text-[#5E656E] hover:text-[#171A1C]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#7D858E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="Cari pesanan"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari kode, nama, email, WA..."
              className="w-full pl-10 pr-4 py-2 text-xs bg-[#F5F6F2] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-full text-[#171A1C] placeholder:text-[#8A929C] focus:outline-none transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#F2F3EE] bg-[#FAFBF8] text-xs font-semibold text-[#6B727B]">
                <th className="py-3.5 px-6">Kode & Waktu</th>
                <th className="py-3.5 px-4">Pembeli & Produk</th>
                <th className="py-3.5 px-4 text-right">Total QRIS</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-6 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2F3EE] text-xs">
              {filteredOrders.map((order) => {
                const isSelected = selectedOrder?.id === order.id;
                return (
                  <tr
                    key={order.id}
                    className={`transition-colors ${
                      isSelected ? 'bg-[#F8FDE8]' : 'hover:bg-[#FAFBF8]'
                    }`}
                  >
                    <td className="py-4 px-6 align-top whitespace-nowrap">
                      <p className="font-mono font-bold text-[#171A1C]">{order.orderCode}</p>
                      <p className="text-[#6B727B] mt-0.5 tabular-nums">
                        {formatDateTime(order.createdAt)}
                      </p>
                    </td>
                    <td className="py-4 px-4 align-top">
                      <p className="font-semibold text-[#171A1C]">{order.buyerName}</p>
                      <p className="text-[#6B727B] mt-0.5">
                        {order.buyerEmail} · +{order.buyerWhatsapp}
                      </p>
                      <p className="text-[#4B525A] mt-0.5 line-clamp-1">
                        {order.productName}
                        {order.qrisChannelLabel ? ` · ${order.qrisChannelLabel}` : ''}
                      </p>
                    </td>
                    <td className="py-4 px-4 text-right align-top whitespace-nowrap">
                      <p className="font-mono font-bold text-[#171A1C] tabular-nums">
                        {formatRupiah(order.totalAmount)}
                      </p>
                      <p className="font-mono text-[#8A929C] mt-0.5 tabular-nums">
                        +{order.uniqueCode} unik
                      </p>
                    </td>
                    <td className="py-4 px-4 align-top whitespace-nowrap">
                      <p
                        className={`font-semibold ${
                          order.status === 'PAID'
                            ? 'text-[#3C6E14]'
                            : order.status === 'PENDING'
                              ? 'text-[#C85A17]'
                              : 'text-[#7D858E]'
                        }`}
                      >
                        {order.status === 'PAID'
                          ? 'Terverifikasi'
                          : order.status === 'PENDING'
                            ? 'Menunggu'
                            : 'Kedaluwarsa'}
                      </p>
                      {order.status === 'PAID' && (
                        <p className="text-[#6B727B] mt-0.5">Email & WA terkirim</p>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right align-top whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectOrder(order.id)}
                        className={`px-3.5 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                          isSelected
                            ? 'bg-pastel-cta text-[#171A1C]'
                            : 'bg-[#F5F6F2] text-[#171A1C] hover:bg-[#E7F4B5]'
                        }`}
                      >
                        {isSelected ? 'Terbuka' : 'Lihat Detail'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#6B727B]">
                    Tidak ada pesanan yang sesuai filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Order & Delivery Detail Inspector */}
      {selectedOrder && (
        <aside
          aria-label="Detail pesanan dan pengiriman akses"
          className="xl:col-span-5 bg-white border border-[#ECEEE6] rounded-[28px] p-6 space-y-5"
        >
          <div className="flex items-start justify-between gap-4 border-b border-[#F2F3EE] pb-4">
            <div>
              <p className="font-mono text-xs text-[#6B727B]">{selectedOrder.orderCode}</p>
              <h2 className="font-display text-base font-bold text-[#171A1C] mt-0.5">
                {selectedOrder.buyerName}
              </h2>
              <p className="text-xs text-[#6B727B] mt-0.5">{selectedOrder.productName}</p>
            </div>
            <button
              type="button"
              aria-label="Tutup panel detail pesanan"
              onClick={() => onSelectOrder(null)}
              className="w-8 h-8 rounded-full bg-[#F5F6F2] text-[#5E656E] hover:text-[#171A1C] hover:bg-[#ECEEE6] flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Payment Summary */}
          <dl className="divide-y divide-[#F2F3EE] text-xs">
            <div className="py-2.5 flex justify-between">
              <dt className="text-[#6B727B]">Status Pembayaran</dt>
              <dd
                className={`font-semibold ${
                  selectedOrder.status === 'PAID'
                    ? 'text-[#3C6E14]'
                    : selectedOrder.status === 'PENDING'
                      ? 'text-[#C85A17]'
                      : 'text-[#7D858E]'
                }`}
              >
                {selectedOrder.status === 'PAID'
                  ? 'Terverifikasi Otomatis'
                  : selectedOrder.status === 'PENDING'
                    ? 'Menunggu Mutasi QRIS'
                    : 'Kedaluwarsa'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-[#6B727B]">Channel QRIS</dt>
              <dd className="font-semibold text-[#171A1C]">
                {selectedOrder.qrisChannelLabel ?? 'DANA Bisnis Utama'}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-[#6B727B]">Total Tagihan QRIS</dt>
              <dd className="font-mono font-bold text-[#171A1C] tabular-nums">
                {formatRupiah(selectedOrder.totalAmount)} ({formatRupiah(selectedOrder.baseAmount)} +{' '}
                {selectedOrder.uniqueCode})
              </dd>
            </div>
            <div className="py-2.5 flex justify-between items-center gap-3">
              <dt className="text-[#6B727B]">Hosted Payment Page</dt>
              <dd className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      'payUrl',
                      `${window.location.origin}/?pay=${encodeURIComponent(selectedOrder.orderCode)}`
                    )
                  }
                  className="px-2.5 py-1 rounded-full bg-[#F5F6F2] hover:bg-[#E7F4B5] text-[11px] font-semibold text-[#171A1C]"
                >
                  {copiedKey === 'payUrl' ? 'Link Disalin' : 'Salin Link Bayar'}
                </button>
                <a
                  href={`/?pay=${encodeURIComponent(selectedOrder.orderCode)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#7E2FA0] hover:underline font-semibold inline-flex items-center gap-0.5"
                >
                  Buka
                  <ExternalLink className="w-3 h-3" />
                </a>
              </dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-[#6B727B]">Waktu Terverifikasi</dt>
              <dd className="font-mono text-[#4B525A] tabular-nums">
                {formatDateTime(selectedOrder.paidAt)}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between items-center gap-3">
              <dt className="text-[#6B727B]">Kunci Lisensi</dt>
              <dd className="flex items-center gap-1.5 font-mono font-semibold text-[#171A1C]">
                <span>{selectedOrder.licenseKey}</span>
                <button
                  type="button"
                  aria-label="Salin kunci lisensi"
                  onClick={() => handleCopy('license', selectedOrder.licenseKey)}
                  className="p-1 text-[#7D858E] hover:text-[#171A1C]"
                >
                  {copiedKey === 'license' ? (
                    <Check className="w-3.5 h-3.5 text-[#3C6E14]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </dd>
            </div>
            <div className="py-2.5 flex justify-between items-center gap-3">
              <dt className="text-[#6B727B]">Link Akses Produk</dt>
              <dd className="truncate max-w-[240px]">
                <a
                  href={selectedOrder.accessUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#7E2FA0] hover:underline font-medium inline-flex items-center gap-1"
                >
                  <span className="truncate">{selectedOrder.accessUrl}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              </dd>
            </div>
          </dl>

          {selectedOrder.status === 'PENDING' && (
            <div className="pt-3 border-t border-[#F2F3EE] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#171A1C]">QRIS Dinamis Pesanan</p>
                <button
                  type="button"
                  disabled={simulatingId === selectedOrder.id}
                  onClick={() => onSimulateOrderPayment(selectedOrder)}
                  className="px-4 py-2 text-xs font-semibold text-[#171A1C] bg-pastel-cta disabled:opacity-50 rounded-full inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" />
                  {simulatingId === selectedOrder.id ? 'Memverifikasi...' : 'Simulasikan Bayar Masuk'}
                </button>
              </div>
              {qrImageUrl && (
                <div className="flex justify-center py-2">
                  <img
                    src={qrImageUrl}
                    alt={`QRIS Dinamis ${selectedOrder.orderCode}`}
                    className="w-44 h-44 rounded-2xl border border-[#ECEEE6] bg-white p-1.5"
                  />
                </div>
              )}
            </div>
          )}

          {/* Email & WhatsApp Real-time Fulfillment Logs */}
          <div className="pt-3 border-t border-[#F2F3EE] space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-[#171A1C]">
                Pengiriman Real-Time (Email & WhatsApp)
              </h3>
              {selectedOrder.status === 'PAID' && (
                <button
                  type="button"
                  disabled={resendingId === selectedOrder.id}
                  onClick={() => handleResend(selectedOrder.id)}
                  className="text-xs font-semibold text-[#5B7A16] hover:text-[#171A1C] inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${resendingId === selectedOrder.id ? 'animate-spin' : ''}`}
                  />
                  Kirim Ulang Akses
                </button>
              )}
            </div>

            {resendNote && (
              <p role="status" className="text-xs text-[#3C6E14] font-semibold">
                {resendNote}
              </p>
            )}

            {/* Email Log */}
            <div className="bg-[#F6F7F4] rounded-2xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#171A1C] inline-flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-[#7E2FA0]" />
                  Email · {selectedOrder.emailDelivery.recipient}
                </span>
                <span
                  className={`font-semibold ${
                    selectedOrder.emailDelivery.status === 'SENT' ||
                    selectedOrder.emailDelivery.status === 'SIMULATED_SENT'
                      ? 'text-[#3C6E14]'
                      : selectedOrder.emailDelivery.status === 'FAILED'
                        ? 'text-[#C83E2B]'
                        : 'text-[#6B727B]'
                  }`}
                >
                  {selectedOrder.emailDelivery.status === 'SENT'
                    ? 'Terkirim'
                    : selectedOrder.emailDelivery.status === 'SIMULATED_SENT'
                      ? 'Terkirim (Pratinjau)'
                      : selectedOrder.emailDelivery.status === 'FAILED'
                        ? 'Gagal'
                        : 'Menunggu Bayar'}
                </span>
              </div>
              {selectedOrder.emailDelivery.sentAt && (
                <p className="text-[11px] font-mono text-[#7D858E] tabular-nums">
                  {formatDateTime(selectedOrder.emailDelivery.sentAt)} · Provider:{' '}
                  {selectedOrder.emailDelivery.provider}
                </p>
              )}
              {selectedOrder.emailDelivery.messagePreview && (
                <pre className="mt-1.5 text-[11px] text-[#4B525A] whitespace-pre-wrap font-sans leading-relaxed max-h-36 overflow-y-auto border-t border-[#E6E8E0] pt-2">
                  {selectedOrder.emailDelivery.messagePreview}
                </pre>
              )}
            </div>

            {/* WhatsApp Log */}
            <div className="bg-[#F6F7F4] rounded-2xl p-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#171A1C] inline-flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#3C6E14]" />
                  WhatsApp · +{selectedOrder.whatsappDelivery.recipient}
                </span>
                <span
                  className={`font-semibold ${
                    selectedOrder.whatsappDelivery.status === 'SENT' ||
                    selectedOrder.whatsappDelivery.status === 'SIMULATED_SENT'
                      ? 'text-[#3C6E14]'
                      : selectedOrder.whatsappDelivery.status === 'FAILED'
                        ? 'text-[#C83E2B]'
                        : 'text-[#6B727B]'
                  }`}
                >
                  {selectedOrder.whatsappDelivery.status === 'SENT'
                    ? 'Terkirim'
                    : selectedOrder.whatsappDelivery.status === 'SIMULATED_SENT'
                      ? 'Terkirim (Pratinjau)'
                      : selectedOrder.whatsappDelivery.status === 'FAILED'
                        ? 'Gagal'
                        : 'Menunggu Bayar'}
                </span>
              </div>
              {selectedOrder.whatsappDelivery.sentAt && (
                <p className="text-[11px] font-mono text-[#7D858E] tabular-nums">
                  {formatDateTime(selectedOrder.whatsappDelivery.sentAt)} · Gateway:{' '}
                  {selectedOrder.whatsappDelivery.provider}
                </p>
              )}
              {selectedOrder.whatsappDelivery.messagePreview && (
                <pre className="mt-1.5 text-[11px] text-[#4B525A] whitespace-pre-wrap font-sans leading-relaxed max-h-36 overflow-y-auto border-t border-[#E6E8E0] pt-2">
                  {selectedOrder.whatsappDelivery.messagePreview}
                </pre>
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
