import { useState, type FormEvent } from 'react';
import { Link2, Search, Send } from 'lucide-react';
import type { DashboardSnapshot, MutationStatus, QrisProvider } from '../types';
import { formatRupiah } from '../lib/qris';
import { QRIS_PROVIDER_PRESETS, getProviderPreset, resolveActiveChannel } from '../lib/qrisChannels';
import { formatDateTime } from '../lib/format';

interface MutationsViewProps {
  snapshot: DashboardSnapshot;
  onRefresh: () => Promise<void>;
}

export function MutationsView({ snapshot, onRefresh }: MutationsViewProps) {
  const [filter, setFilter] = useState<'ALL' | MutationStatus>('ALL');
  const [query, setQuery] = useState('');

  const activeChannel = resolveActiveChannel(
    snapshot.qrisChannels,
    null,
    snapshot.settings.activeQrisChannelId
  );

  // Simulator state
  const [selectedPendingId, setSelectedPendingId] = useState('');
  const [simProvider, setSimProvider] = useState<QrisProvider>(activeChannel.provider);
  const [simMessage, setSimMessage] = useState('');
  const [simSender, setSimSender] = useState('');
  const [simSubmitting, setSimSubmitting] = useState(false);
  const [simFeedback, setSimFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [matchingKey, setMatchingKey] = useState<string | null>(null);

  const pendingOrders = snapshot.orders.filter((o) => o.status === 'PENDING');
  const matchableOrders = snapshot.orders.filter((o) => o.status !== 'PAID');

  const filteredMutations = snapshot.mutations.filter((mut) => {
    if (filter !== 'ALL' && mut.status !== filter) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      return (
        mut.senderName.toLowerCase().includes(q) ||
        mut.rawMessage.toLowerCase().includes(q) ||
        mut.referenceId.toLowerCase().includes(q) ||
        String(mut.amount).includes(q) ||
        (mut.matchedOrderCode ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  function handleSelectPendingPreset(orderId: string) {
    setSelectedPendingId(orderId);
    const order = pendingOrders.find((o) => o.id === orderId);
    if (order) {
      const formattedNominal = new Intl.NumberFormat('id-ID').format(order.totalAmount);
      const orderProv = order.qrisProvider ?? activeChannel.provider;
      setSimProvider(orderProv);
      setSimSender(order.buyerName.toUpperCase());
      setSimMessage(
        orderProv === 'NEOBANK'
          ? `Anda menerima pembayaran QRIS sebesar Rp ${formattedNominal} dari ${order.buyerName.toUpperCase()} di Neobank`
          : `Kamu baru saja menerima pembayaran Rp ${formattedNominal} melalui QRIS dari ${order.buyerName.toUpperCase()}`
      );
      setSimFeedback(null);
    }
  }

  async function handleSimulateSubmit(e: FormEvent) {
    e.preventDefault();
    setSimFeedback(null);
    if (!simMessage.trim()) {
      setSimFeedback({
        type: 'error',
        text: 'Masukkan teks notifikasi pembayaran QRIS terlebih dahulu.',
      });
      return;
    }

    const preset = getProviderPreset(simProvider);
    setSimSubmitting(true);
    try {
      const res = await fetch('/api/simulate/dana-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${preset.name} — Pembayaran QRIS`,
          message: simMessage.trim(),
          senderName: simSender.trim() || undefined,
          packageName: preset.defaultPackageName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSimFeedback({ type: 'error', text: data.error || 'Gagal memproses notifikasi.' });
        return;
      }

      if (data.matchedOrder) {
        setSimFeedback({
          type: 'success',
          text: `Mutasi ${formatRupiah(data.mutation.amount)} cocok otomatis dengan pesanan ${data.matchedOrder.orderCode}. Akses Email & WhatsApp dikirim real-time.`,
        });
      } else {
        setSimFeedback({
          type: 'success',
          text: `Mutasi ${formatRupiah(data.mutation.amount)} dicatat sebagai Belum Cocok (tidak ada tagihan aktif dengan nominal tersebut).`,
        });
      }
      setSimMessage('');
      setSimSender('');
      setSelectedPendingId('');
      await onRefresh();
    } catch {
      setSimFeedback({ type: 'error', text: 'Gagal terhubung ke server webhook.' });
    } finally {
      setSimSubmitting(false);
    }
  }

  async function handleManualMatch(mutationId: string, orderId: string) {
    if (!orderId) return;
    setMatchingKey(mutationId);
    try {
      const res = await fetch(`/api/mutations/${mutationId}/match/${orderId}`, {
        method: 'POST',
      });
      if (res.ok) {
        await onRefresh();
      }
    } finally {
      setMatchingKey(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Interactive Multi-QRIS Notification Webhook Tester */}
      <section className="bg-pastel-hero rounded-[28px] p-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#171A1C]">
              Uji Penerimaan Notifikasi Mutasi Multi-QRIS
            </h2>
            <p className="text-xs text-[#432E4C]/85 mt-1 max-w-2xl leading-relaxed">
              Kirim format notifikasi Android dari DANA Bisnis, Neobank (BNC), GoPay Merchant, atau QRIS Bank ke mesin parser dan pencocokan otomatis. Saat nominal cocok dengan tagihan aktif, sistem langsung memverifikasi pesanan dan mengirim akses produk.
            </p>
          </div>
          {pendingOrders.length > 0 && (
            <div className="w-full md:w-72 shrink-0">
              <label
                htmlFor="preset-pending-order"
                className="block text-xs font-semibold text-[#3C2446] mb-1.5"
              >
                Isi cepat dari tagihan aktif
              </label>
              <select
                id="preset-pending-order"
                value={selectedPendingId}
                onChange={(e) => handleSelectPendingPreset(e.target.value)}
                className="w-full px-4 py-2.5 text-xs bg-white/90 border border-white rounded-full text-[#171A1C] focus:outline-none focus:ring-2 focus:ring-[#CBE855]"
              >
                <option value="">Pilih tagihan menunggu...</option>
                {pendingOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderCode} · {o.buyerName} ({formatRupiah(o.totalAmount)})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSimulateSubmit}
          className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-end"
        >
          <div className="lg:col-span-2">
            <label
              htmlFor="sim-provider"
              className="block text-xs font-semibold text-[#3C2446] mb-1.5"
            >
              Sumber Aplikasi
            </label>
            <select
              id="sim-provider"
              value={simProvider}
              onChange={(e) => setSimProvider(e.target.value as QrisProvider)}
              className="w-full px-3.5 py-2.5 text-xs font-semibold bg-white/95 border border-white rounded-2xl text-[#171A1C] focus:outline-none focus:ring-2 focus:ring-[#CBE855]"
            >
              {QRIS_PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-6">
            <label
              htmlFor="sim-dana-message"
              className="block text-xs font-semibold text-[#3C2446] mb-1.5"
            >
              Teks Notifikasi QRIS Masuk
            </label>
            <input
              id="sim-dana-message"
              type="text"
              value={simMessage}
              onChange={(e) => setSimMessage(e.target.value)}
              placeholder="Contoh: Anda menerima pembayaran QRIS sebesar Rp 249.412 dari DIMAS PRATAMA"
              className="w-full px-4 py-2.5 text-sm bg-white/95 border border-white rounded-2xl text-[#171A1C] placeholder:text-[#8A929C] focus:outline-none focus:ring-2 focus:ring-[#CBE855]"
            />
          </div>

          <div className="lg:col-span-2">
            <label
              htmlFor="sim-dana-sender"
              className="block text-xs font-semibold text-[#3C2446] mb-1.5"
            >
              Pengirim (Opsional)
            </label>
            <input
              id="sim-dana-sender"
              type="text"
              value={simSender}
              onChange={(e) => setSimSender(e.target.value)}
              placeholder="Otomatis"
              className="w-full px-4 py-2.5 text-sm bg-white/95 border border-white rounded-2xl text-[#171A1C] placeholder:text-[#8A929C] focus:outline-none focus:ring-2 focus:ring-[#CBE855]"
            />
          </div>

          <div className="lg:col-span-2">
            <button
              type="submit"
              disabled={simSubmitting}
              className="w-full px-5 py-2.5 text-sm font-semibold text-[#D8F36A] bg-[#171A1C] hover:bg-[#2B3035] disabled:opacity-50 rounded-full transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              {simSubmitting ? 'Mengirim...' : 'Kirim Mutasi'}
            </button>
          </div>
        </form>

        {simFeedback && (
          <p
            role="status"
            className={`mt-3 text-xs font-semibold ${
              simFeedback.type === 'success' ? 'text-[#255414]' : 'text-[#B92D1F]'
            }`}
          >
            {simFeedback.text}
          </p>
        )}
      </section>

      {/* Mutations Ledger Table */}
      <section className="bg-white border border-[#ECEEE6] rounded-[28px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F2F3EE] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div
            className="flex items-center gap-1.5 p-1 bg-[#F5F6F2] rounded-full w-fit"
            role="tablist"
            aria-label="Filter status mutasi"
          >
            {(
              [
                { id: 'ALL', label: `Semua (${snapshot.mutations.length})` },
                {
                  id: 'MATCHED',
                  label: `Cocok (${snapshot.mutations.filter((m) => m.status === 'MATCHED').length})`,
                },
                {
                  id: 'UNMATCHED',
                  label: `Belum Cocok (${snapshot.mutations.filter((m) => m.status === 'UNMATCHED').length})`,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all whitespace-nowrap ${
                  filter === tab.id
                    ? 'bg-white border border-[#CBE855] text-[#171A1C] font-semibold shadow-2xs'
                    : 'text-[#5E656E] hover:text-[#171A1C]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-[#7D858E] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              aria-label="Cari mutasi QRIS"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nominal, pengirim, referensi..."
              className="w-full pl-10 pr-4 py-2 text-xs bg-[#F5F6F2] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-full text-[#171A1C] placeholder:text-[#8A929C] focus:outline-none transition-colors"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#F2F3EE] bg-[#FAFBF8] text-xs font-semibold text-[#6B727B]">
                <th className="py-3.5 px-6">Waktu Masuk</th>
                <th className="py-3.5 px-4">Pengirim & Notifikasi QRIS</th>
                <th className="py-3.5 px-4">Referensi</th>
                <th className="py-3.5 px-4 text-right">Nominal Masuk</th>
                <th className="py-3.5 px-6">Status Pencocokan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F2F3EE] text-xs">
              {filteredMutations.map((mut) => (
                <tr key={mut.id} className="hover:bg-[#FAFBF8] transition-colors">
                  <td className="py-4 px-6 text-[#5E656E] font-mono tabular-nums whitespace-nowrap align-top">
                    {formatDateTime(mut.receivedAt)}
                  </td>
                  <td className="py-4 px-4 align-top max-w-md">
                    <p className="font-semibold text-[#171A1C]">
                      {mut.senderName}{' '}
                      {mut.providerName && (
                        <span className="ml-1.5 px-2 py-0.5 rounded-full bg-[#F5F6F2] text-[10px] font-semibold text-[#5E656E]">
                          {mut.providerName}
                        </span>
                      )}
                    </p>
                    <p className="text-[#5E656E] mt-0.5 leading-relaxed">{mut.rawMessage}</p>
                    <p className="text-[#8A929C] mt-0.5 font-mono">
                      {mut.packageName} · {mut.source === 'DANA_WEBHOOK' ? 'Webhook Android' : 'Simulasi'}
                    </p>
                  </td>
                  <td className="py-4 px-4 font-mono text-[#5E656E] whitespace-nowrap align-top">
                    {mut.referenceId}
                  </td>
                  <td className="py-4 px-4 text-right font-mono font-bold text-[#171A1C] tabular-nums whitespace-nowrap align-top">
                    +{formatRupiah(mut.amount)}
                  </td>
                  <td className="py-4 px-6 align-top whitespace-nowrap">
                    {mut.status === 'MATCHED' ? (
                      <div>
                        <p className="font-semibold text-[#3C6E14]">Cocok Otomatis</p>
                        <p className="font-mono text-[#6B727B] mt-0.5">{mut.matchedOrderCode}</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="font-semibold text-[#C85A17]">Belum Cocok</p>
                        {matchableOrders.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <Link2 className="w-3.5 h-3.5 text-[#8A929C] shrink-0" aria-hidden="true" />
                            <select
                              aria-label={`Cocokkan mutasi ${mut.referenceId} secara manual`}
                              disabled={matchingKey === mut.id}
                              defaultValue=""
                              onChange={(e) => handleManualMatch(mut.id, e.target.value)}
                              className="px-3 py-1.5 text-xs border border-[#ECEEE6] rounded-full bg-[#FAFBF8] text-[#171A1C] focus:outline-none focus:border-[#CBE855]"
                            >
                              <option value="">Cocokkan manual...</option>
                              {matchableOrders.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.orderCode} · {o.buyerName} ({formatRupiah(o.totalAmount)})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filteredMutations.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[#6B727B]">
                    Tidak ada catatan mutasi QRIS yang sesuai dengan filter saat ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
