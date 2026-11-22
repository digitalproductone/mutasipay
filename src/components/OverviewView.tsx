import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Plus,
  QrCode,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Wallet,
  Webhook,
} from 'lucide-react';
import type { DashboardSnapshot, OrderRecord } from '../types';
import type { TabKey } from '../App';
import { formatRupiah, parseQrisMetadata } from '../lib/qris';
import { resolveActiveChannel } from '../lib/qrisChannels';
import { formatDateTime } from '../lib/format';

interface OverviewViewProps {
  snapshot: DashboardSnapshot;
  onNavigate: (tab: TabKey) => void;
  onSimulateOrderPayment: (order: OrderRecord) => Promise<void>;
  onSelectOrder: (orderId: string) => void;
  simulatingId: string | null;
}

function getIndonesianGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 19) return 'Selamat sore';
  return 'Selamat malam';
}

function formatCompactRp(amount: number): string {
  if (amount >= 1_000_000) {
    const val = (amount / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${val}jt`;
  }
  if (amount >= 1_000) {
    return `${Math.round(amount / 1_000)}rb`;
  }
  return String(amount);
}

export function OverviewView({
  snapshot,
  onNavigate,
  onSimulateOrderPayment,
  onSelectOrder,
  simulatingId,
}: OverviewViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [focusMetric, setFocusMetric] = useState<'qris' | 'mutasi' | 'email' | 'wa'>('qris');

  const activeChannel = resolveActiveChannel(
    snapshot.qrisChannels,
    null,
    snapshot.settings.activeQrisChannelId
  );
  const qrisMeta = parseQrisMetadata(activeChannel.staticQris);

  const paidOrders = snapshot.orders.filter((o) => o.status === 'PAID');
  const pendingOrders = snapshot.orders.filter((o) => o.status === 'PENDING');
  const totalRevenue = paidOrders.reduce((sum, o) => sum + o.totalAmount, 0);
  const matchedMutations = snapshot.mutations.filter((m) => m.status === 'MATCHED').length;
  const unmatchedMutations = snapshot.mutations.filter((m) => m.status === 'UNMATCHED').length;
  const deliveredCount = paidOrders.filter(
    (o) =>
      (o.emailDelivery.status === 'SENT' || o.emailDelivery.status === 'SIMULATED_SENT') &&
      (o.whatsappDelivery.status === 'SENT' || o.whatsappDelivery.status === 'SIMULATED_SENT')
  ).length;

  // Filtered recent orders for the left "Saved & Favorites"-style list
  const highlightedOrders = useMemo(() => {
    const combined = [...pendingOrders, ...paidOrders];
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? combined.filter(
          (o) =>
            o.buyerName.toLowerCase().includes(q) ||
            o.productName.toLowerCase().includes(q) ||
            o.orderCode.toLowerCase().includes(q) ||
            String(o.totalAmount).includes(q)
        )
      : combined;
    return filtered.slice(0, 4);
  }, [pendingOrders, paidOrders, searchQuery]);

  // Donut chart percentages (SVG stroke-dasharray on radius 44, circumference = 276.46)
  const circumference = 2 * Math.PI * 44;
  const totalRingUnits = Math.max(1, paidOrders.length + pendingOrders.length + unmatchedMutations);
  const paidArc = (paidOrders.length / totalRingUnits) * circumference;
  const pendingArc = (pendingOrders.length / totalRingUnits) * circumference;
  const unmatchedArc = Math.max(0, circumference - paidArc - pendingArc);

  // Sparkline points derived from latest mutation amounts (fallback gentle curve if few)
  const sparkValues = useMemo(() => {
    const latest = snapshot.mutations
      .slice(0, 7)
      .reverse()
      .map((m) => m.amount);
    if (latest.length >= 3) return latest;
    return [45000, 99000, 75000, 149000, 129000, 199000];
  }, [snapshot.mutations]);

  const sparklinePath = useMemo(() => {
    const maxVal = Math.max(...sparkValues, 1);
    const minVal = Math.min(...sparkValues, 0);
    const range = Math.max(1, maxVal - minVal);
    const width = 128;
    const height = 46;
    const pts = sparkValues.map((v, idx) => {
      const x = (idx / Math.max(1, sparkValues.length - 1)) * (width - 12) + 6;
      const y = height - 6 - ((v - minVal) / range) * (height - 14);
      return { x, y };
    });
    const d = pts
      .map((p, i) => {
        if (i === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        const prev = pts[i - 1];
        const cx = ((prev.x + p.x) / 2).toFixed(1);
        return `C ${cx} ${prev.y.toFixed(1)}, ${cx} ${p.y.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      })
      .join(' ');
    const peak = pts.reduce((best, p) => (p.y < best.y ? p : best), pts[0]);
    return { d, peak };
  }, [sparkValues]);

  // Compact 7-day calendar strip centered on today
  const dateStrip = useMemo(() => {
    const today = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return [-3, -2, -1, 0, 1, 2, 3].map((offset) => {
      const d = new Date(today);
      d.setDate(today.getDate() + offset);
      return {
        key: offset,
        isToday: offset === 0,
        label:
          offset === 0
            ? `Hari ini, ${d.getDate()} ${months[d.getMonth()]}`
            : String(d.getDate()),
      };
    });
  }, []);

  // 7-day weekday activity buckets
  const weekdayTiles = useMemo(() => {
    const days = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const m of snapshot.mutations) {
      const jsDay = new Date(m.receivedAt).getDay(); // 0=Sun
      const idx = jsDay === 0 ? 6 : jsDay - 1;
      counts[idx] += 1;
    }
    const todayJs = new Date().getDay();
    const todayIdx = todayJs === 0 ? 6 : todayJs - 1;
    const tones = [
      'bg-[#FFE0D6] text-[#8F311D]',
      'bg-[#F9DCF8] text-[#6B2A73]',
      'bg-[#D4ECFC] text-[#174F73]',
      'bg-[#EFECE8] text-[#5B554E]',
      'bg-[#DCF46F] text-[#283B09]',
      'bg-[#FFE8CC] text-[#7D470A]',
      'bg-[#F7D7FC] text-[#61276A]',
    ];
    return days.map((label, idx) => ({
      label,
      count: counts[idx],
      isToday: idx === todayIdx,
      tone: tones[idx],
    }));
  }, [snapshot.mutations]);

  const dialDetails: Record<
    'qris' | 'mutasi' | 'email' | 'wa',
    { title: string; status: string; helper: string; target: TabKey }
  > = {
    qris: {
      title: 'QRIS',
      status: qrisMeta.valid ? `${snapshot.qrisChannels.length} Channel` : 'Cek CRC',
      helper: `${activeChannel.providerName} · ${qrisMeta.merchantName}`,
      target: 'integration',
    },
    mutasi: {
      title: 'MUTASI',
      status: `${matchedMutations} Cocok`,
      helper: `${snapshot.mutations.length} notifikasi Multi-QRIS tercatat`,
      target: 'mutations',
    },
    email: {
      title: 'EMAIL',
      status: snapshot.integration.emailConfigured ? 'Live SMTP' : 'Pratinjau',
      helper: `${deliveredCount} akses produk terkirim real-time`,
      target: 'orders',
    },
    wa: {
      title: 'WHATSAPP',
      status: snapshot.integration.whatsappConfigured ? 'Live WA' : 'Pratinjau',
      helper: `${snapshot.webhooks.length} webhook keluar terhubung`,
      target: 'api',
    },
  };

  const activeDial = dialDetails[focusMetric];

  return (
    <div className="space-y-5">
      {/* Top Greeting + Quick Category Pills + Live Search Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
        <div className="lg:col-span-8 space-y-3.5">
          <h1 className="font-display text-2xl sm:text-[28px] font-bold tracking-tight text-[#171A1C] inline-flex items-center flex-wrap gap-2">
            <span>
              {getIndonesianGreeting()}, {qrisMeta.merchantName}
            </span>
            <span
              aria-hidden="true"
              className="w-7 h-7 rounded-full bg-[#FEF1B8] text-[#B97A00] inline-flex items-center justify-center shrink-0 align-middle"
            >
              <Sparkles className="w-4 h-4" />
            </span>
          </h1>

          {/* Segmented Rounded Tab Row — Matching Activity / Mood / Food / Sleep */}
          <div className="flex items-center gap-2.5 overflow-x-auto pb-0.5">
            {(
              [
                { id: 'overview', label: 'Ringkasan', active: true },
                { id: 'mutations', label: 'Mutasi QRIS', active: false },
                { id: 'products', label: 'Produk Digital', active: false },
                { id: 'api', label: 'API & Webhook', active: false },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => onNavigate(pill.id)}
                className={`px-5 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                  pill.active
                    ? 'bg-white border border-[#CBE855] text-[#171A1C] font-semibold shadow-2xs'
                    : 'bg-white border border-[#F0F1EC] text-[#5E656E] hover:border-[#D4EF65] hover:text-[#171A1C]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right Search Bar + Lime-Bordered QR Quick Launcher */}
        <div className="lg:col-span-4 flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-[#7D858E] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="Cari pesanan atau pembeli"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari kode pesanan, pembeli, nominal..."
              className="w-full pl-10 pr-4 py-2.5 text-xs bg-[#F5F6F2] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-full text-[#171A1C] placeholder:text-[#8A929C] focus:outline-none transition-colors"
            />
          </div>
          <button
            type="button"
            title="Buat Checkout QRIS Baru"
            aria-label="Buat Checkout QRIS Baru"
            onClick={() => onNavigate('checkout')}
            className="w-10 h-10 rounded-full bg-white border border-[#CBE855] hover:bg-[#F7FDE4] text-[#171A1C] flex items-center justify-center shrink-0 transition-colors"
          >
            <QrCode className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

      {/* Main 3-Column Soft Pastel Bento Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* COLUMN 1 (Left 4 cols): Lavender Hero QRIS Card + Recent Orders List */}
        <div className="lg:col-span-4 space-y-5">
          {/* Featured Lavender-Pink Hero Card */}
          <section className="bg-pastel-hero rounded-[28px] p-5 flex flex-col justify-between min-h-[268px] relative overflow-hidden">
            {/* Soft radial decor */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-10 w-44 h-44 rounded-full bg-white/30 blur-2xl"
            />

            <div className="relative flex items-center justify-between gap-2">
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-2xs">
                <QrCode className="w-5 h-5 text-[#171A1C]" />
              </div>
              <button
                type="button"
                onClick={() => onNavigate('integration')}
                className="px-3 py-1.5 rounded-full border border-[#171A1C]/15 bg-white/35 hover:bg-white/60 text-[11px] font-semibold text-[#171A1C] inline-flex items-center gap-1.5 transition-colors font-mono tabular-nums"
              >
                <Clock className="w-3.5 h-3.5" />
                {snapshot.settings.expiryMinutes} mnt · CRC {qrisMeta.crcProvided}
              </button>
            </div>

            {/* Center Floating QR Medallion + Action Trigger */}
            <div className="relative my-5 flex items-center justify-center">
              <div className="w-44 h-28 rounded-[24px] bg-white/75 backdrop-blur-xs border border-white/80 flex items-center justify-between px-4 shadow-sm">
                <div className="space-y-1 min-w-0">
                  <p className="text-[10px] font-semibold text-[#6F4C7A] truncate">
                    {activeChannel.providerName}
                  </p>
                  <p className="font-mono text-[11px] font-bold text-[#171A1C] tabular-nums">
                    {qrisMeta.nmid.slice(-8)}
                  </p>
                  <p className="text-[10px] text-[#5B4763]">
                    {snapshot.qrisChannels.length} QRIS · {snapshot.products.length} Produk
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Mulai checkout QRIS dinamis"
                  onClick={() => onNavigate('checkout')}
                  className="w-14 h-14 rounded-full bg-white ring-4 ring-[#D6F163] hover:scale-105 transition-transform flex items-center justify-center shadow-sm text-[#171A1C]"
                >
                  <ArrowUpRight className="w-6 h-6" strokeWidth={2.2} />
                </button>
              </div>
            </div>

            <div className="relative">
              <h2 className="font-display text-lg font-bold text-[#171A1C] leading-snug">
                Checkout QRIS Dinamis
              </h2>
              <p className="text-xs text-[#3D2C44]/85 mt-1 leading-relaxed">
                Otomatis konversi QRIS statis + kode unik & kirim akses produk via Email dan WhatsApp.
              </p>
            </div>
          </section>

          {/* Saved & Favorites Style List: Active Pending & Recent Orders */}
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="font-display text-sm font-bold text-[#171A1C] inline-flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-[#FBE5FE] text-[#B847C9] inline-flex items-center justify-center">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </span>
                Tagihan & Pengiriman Terbaru
              </h2>
              <button
                type="button"
                aria-label="Lihat semua pesanan"
                onClick={() => onNavigate('orders')}
                className="w-7 h-7 rounded-full hover:bg-[#F5F6F1] text-[#5B7A16] flex items-center justify-center transition-colors"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              {highlightedOrders.map((order) => {
                const isPending = order.status === 'PENDING';
                return (
                  <div
                    key={order.id}
                    className="relative bg-[#F6F7F4] hover:bg-[#F0F2EB] rounded-[22px] p-3.5 transition-colors overflow-hidden"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onSelectOrder(order.id)}
                        className="flex items-center gap-3 min-w-0 text-left flex-1"
                      >
                        <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shrink-0 shadow-2xs">
                          {isPending ? (
                            <Clock className="w-4 h-4 text-[#D97706]" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-[#3F7A1C]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#171A1C] truncate">
                            {order.buyerName}
                          </p>
                          <p className="text-[11px] text-[#6B727B] truncate mt-0.5">
                            {order.orderCode} · {order.productName}
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="px-2.5 py-1 rounded-full bg-[#ECEEE7] text-[11px] font-mono font-semibold text-[#171A1C] tabular-nums">
                          {formatRupiah(order.totalAmount)}
                        </span>

                        {isPending ? (
                          <button
                            type="button"
                            disabled={simulatingId === order.id}
                            onClick={() => onSimulateOrderPayment(order)}
                            title="Simulasikan mutasi DANA Bisnis masuk untuk tagihan ini"
                            aria-label={`Uji bayar masuk ${order.orderCode}`}
                            className="w-9 h-9 rounded-full bg-pastel-circle hover:brightness-95 disabled:opacity-50 text-[#171A1C] flex items-center justify-center transition-all shrink-0"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onSelectOrder(order.id)}
                            title="Lihat log pengiriman Email & WhatsApp"
                            aria-label={`Detail pesanan ${order.orderCode}`}
                            className="w-9 h-9 rounded-full bg-white hover:bg-[#E7F4B5] text-[#171A1C] flex items-center justify-center transition-colors shrink-0"
                          >
                            <ArrowUpRight className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Signature bottom lime-to-pink gradient progress edge */}
                    <div
                      aria-hidden="true"
                      className={`absolute bottom-0 left-3 right-3 h-[3px] rounded-full ${
                        isPending ? 'bg-pastel-bar' : 'bg-[#CBE855]'
                      }`}
                    />
                  </div>
                );
              })}

              {highlightedOrders.length === 0 && (
                <div className="bg-[#F6F7F4] rounded-[22px] p-6 text-center">
                  <p className="text-xs font-semibold text-[#171A1C]">
                    {searchQuery ? 'Tidak ada pesanan cocok dengan pencarian.' : 'Belum ada transaksi QRIS.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('checkout')}
                    className="mt-3 px-4 py-2 rounded-full bg-pastel-cta text-xs font-semibold text-[#171A1C]"
                  >
                    Buat Checkout Pertama
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* COLUMN 2 (Middle 4 cols): Twin Pastel KPI Cards + Donut Analytics + 2 Mini Cards + Gateway Strip */}
        <div className="lg:col-span-4 space-y-5">
          {/* Twin Pastel KPI Cards — Lime & Lavender */}
          <div className="grid grid-cols-2 gap-4">
            <section className="bg-pastel-lime rounded-[26px] p-4 flex flex-col justify-between min-h-[138px]">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-2xs">
                  <Wallet className="w-4 h-4 text-[#171A1C]" />
                </div>
                <button
                  type="button"
                  aria-label="Lihat laporan pesanan lunas"
                  onClick={() => onNavigate('orders')}
                  className="w-8 h-8 rounded-full bg-[#171A1C] text-[#D8F36A] hover:bg-[#2C3136] flex items-center justify-center transition-colors"
                >
                  <ArrowUpRight className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-3">
                <p className="text-xs font-medium text-[#2F3E10]">Omzet Terverifikasi</p>
                <p className="font-display text-lg sm:text-xl font-bold text-[#171A1C] font-mono tabular-nums tracking-tight mt-0.5 truncate">
                  {formatRupiah(totalRevenue)}
                </p>
              </div>
            </section>

            <section className="bg-pastel-lavender rounded-[26px] p-4 flex flex-col justify-between min-h-[138px]">
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-2xs">
                  <Mail className="w-4 h-4 text-[#6B2D80]" />
                </div>
                <button
                  type="button"
                  aria-label="Buat tagihan baru"
                  onClick={() => onNavigate('checkout')}
                  className="w-8 h-8 rounded-full bg-[#E6B2F8] text-[#171A1C] hover:bg-[#DCA0F3] flex items-center justify-center transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-3">
                <p className="text-xs font-medium text-[#4F265C]">Akses Terkirim</p>
                <p className="font-display text-xl font-bold text-[#171A1C] font-mono tabular-nums mt-0.5">
                  {deliveredCount}/{Math.max(1, snapshot.orders.length)}
                </p>
              </div>
            </section>
          </div>

          {/* Multi-Segment Pastel Donut Card — Matching "Emotional Check-ins" */}
          <section className="bg-white border border-[#ECEEE6] rounded-[26px] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-[#171A1C]">
                Ringkasan Verifikasi
              </h2>
              <button
                type="button"
                aria-label="Kelola mutasi QRIS"
                onClick={() => onNavigate('mutations')}
                className="p-1.5 rounded-full text-[#5E656E] hover:bg-[#F5F6F1] hover:text-[#171A1C] transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              {/* Left 3 Vertical-Bar Metric Rows */}
              <div className="space-y-3 min-w-0">
                <div className="flex items-start gap-2.5">
                  <span className="w-1 h-8 rounded-full bg-[#CBE855] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-[#171A1C] tabular-nums">
                      {paidOrders.length} Lunas
                    </p>
                    <p className="text-[11px] text-[#7D858E]">Terverifikasi QRIS</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-1 h-8 rounded-full bg-[#7EC3F3] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-[#171A1C] tabular-nums">
                      {pendingOrders.length} Menunggu
                    </p>
                    <p className="text-[11px] text-[#7D858E]">Tagihan aktif</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-1 h-8 rounded-full bg-[#F1B8F8] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-[#171A1C] tabular-nums">
                      {unmatchedMutations} Tinjau
                    </p>
                    <p className="text-[11px] text-[#7D858E]">Mutasi belum cocok</p>
                  </div>
                </div>
              </div>

              {/* Right Multi-Segment Pastel SVG Donut */}
              <div className="relative w-[124px] h-[124px] shrink-0 flex items-center justify-center">
                <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" aria-hidden="true">
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#F2F3EE"
                    strokeWidth="18"
                  />
                  {/* Paid Segment — Lime */}
                  <circle
                    cx="60"
                    cy="60"
                    r="44"
                    fill="none"
                    stroke="#D4EF65"
                    strokeWidth="18"
                    strokeDasharray={`${paidArc} ${circumference}`}
                    strokeDashoffset="0"
                    strokeLinecap="round"
                  />
                  {/* Pending Segment — Sky Blue */}
                  {pendingArc > 0 && (
                    <circle
                      cx="60"
                      cy="60"
                      r="44"
                      fill="none"
                      stroke="#7EC3F3"
                      strokeWidth="18"
                      strokeDasharray={`${pendingArc} ${circumference}`}
                      strokeDashoffset={-paidArc}
                      strokeLinecap="round"
                    />
                  )}
                  {/* Unmatched Segment — Lavender */}
                  {unmatchedArc > 0 && (
                    <circle
                      cx="60"
                      cy="60"
                      r="44"
                      fill="none"
                      stroke="#E9B8FB"
                      strokeWidth="18"
                      strokeDasharray={`${unmatchedArc} ${circumference}`}
                      strokeDashoffset={-(paidArc + pendingArc)}
                      strokeLinecap="round"
                    />
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="font-mono text-sm font-bold text-[#171A1C] tabular-nums">
                    {Math.round((matchedMutations / Math.max(1, snapshot.mutations.length)) * 100)}%
                  </span>
                  <span className="text-[10px] text-[#7D858E]">Cocok</span>
                </div>
              </div>
            </div>

            {/* Bottom 7-Day Activity Tiles */}
            <div className="grid grid-cols-7 gap-1.5 pt-1">
              {weekdayTiles.map((day) => (
                <div key={day.label} className="flex flex-col items-center gap-1">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-mono font-bold tabular-nums ${
                      day.isToday ? 'ring-2 ring-[#CBE855] ' : ''
                    }${day.tone}`}
                  >
                    {day.count}
                  </div>
                  <span
                    className={`text-[10px] ${
                      day.isToday ? 'font-bold text-[#6F8F1B]' : 'text-[#8A929C]'
                    }`}
                  >
                    {day.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Twin Mini Visual Cards — Matching "Intake" & "Mental Effect" */}
          <div className="grid grid-cols-2 gap-4">
            {/* Kanal Aktif Matrix */}
            <section className="bg-white border border-[#ECEEE6] rounded-[24px] p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-xs font-bold text-[#171A1C]">Kanal Akses</h3>
                  <p className="text-[11px] text-[#7D858E]">Email · WA · API</p>
                </div>
                <span className="w-7 h-7 rounded-full bg-[#F5F6F2] text-[#4B525A] flex items-center justify-center">
                  <MessageSquare className="w-3.5 h-3.5" />
                </span>
              </div>

              <div className="space-y-1.5" aria-hidden="true">
                <div className="grid grid-cols-6 gap-1">
                  <span className="h-3.5 col-span-2 rounded bg-[#7EC3F3]" />
                  <span className="h-3.5 col-span-1 rounded bg-[#E9B8FB]" />
                  <span className="h-3.5 col-span-2 rounded bg-[#D4EF65]" />
                  <span className="h-3.5 col-span-1 rounded bg-[#F5C6FA]" />
                </div>
                <div className="grid grid-cols-6 gap-1">
                  <span className="h-3.5 col-span-1 rounded bg-[#D4EF65]" />
                  <span className="h-3.5 col-span-3 rounded bg-[#7EC3F3]" />
                  <span className="h-3.5 col-span-2 rounded bg-[#D4EF65]" />
                </div>
                <div className="grid grid-cols-6 gap-1">
                  <span className="h-3.5 col-span-2 rounded bg-[#E9B8FB]" />
                  <span className="h-3.5 col-span-2 rounded bg-[#D4EF65]" />
                  <span className="h-3.5 col-span-2 rounded bg-[#7EC3F3]" />
                </div>
              </div>
            </section>

            {/* Mutation Sparkline */}
            <section className="bg-white border border-[#ECEEE6] rounded-[24px] p-4 flex flex-col justify-between">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-xs font-bold text-[#171A1C]">Tren Mutasi</h3>
                  <p className="text-[11px] font-medium text-[#C54C82] tabular-nums">
                    {matchedMutations} Terverifikasi
                  </p>
                </div>
                <span className="w-7 h-7 rounded-full bg-[#FCE5F2] text-[#C54C82] flex items-center justify-center font-mono text-[10px] font-bold">
                  QR
                </span>
              </div>

              <svg viewBox="0 0 128 46" className="w-full h-11 mt-1" aria-hidden="true">
                <path
                  d={sparklinePath.d}
                  fill="none"
                  stroke="#B8DC3E"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                />
                <circle
                  cx={sparklinePath.peak.x}
                  cy={sparklinePath.peak.y}
                  r="4"
                  fill="#D4EF65"
                  stroke="#FFFFFF"
                  strokeWidth="2"
                />
              </svg>
            </section>
          </div>

          {/* Bottom Compact Card — API & Webhook Gateway Shortcut */}
          <button
            type="button"
            onClick={() => onNavigate('api')}
            className="w-full text-left bg-white border border-[#ECEEE6] hover:border-[#CBE855] rounded-[24px] p-4 transition-colors flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-2xl bg-[#F6F7F4] flex items-center justify-center shrink-0 text-[#171A1C]">
                <Webhook className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="font-display text-xs font-bold text-[#171A1C]">
                  Payment Gateway API v1
                </p>
                <p className="text-[11px] text-[#6B727B] truncate mt-0.5 tabular-nums">
                  {snapshot.webhooks.length} webhook aktif · {snapshot.webhookLogs.length} log terkirim
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold text-[#9C44B8] shrink-0">
              API →
            </span>
          </button>
        </div>

        {/* COLUMN 3 (Right 4 cols): Date Strip + Recent Mutation Tiles + Radial QRIS Monitor + Gradient CTA */}
        <div className="lg:col-span-4 space-y-5">
          {/* 7-Day Date Strip */}
          <div className="flex items-center justify-between gap-1 text-xs px-1">
            {dateStrip.map((item) => (
              <span
                key={item.key}
                className={
                  item.isToday
                    ? 'px-3.5 py-1.5 rounded-full bg-white border border-[#CBE855] font-semibold text-[#171A1C] shadow-2xs whitespace-nowrap'
                    : 'px-2 py-1 text-[#6B727B] font-medium tabular-nums'
                }
              >
                {item.label}
              </span>
            ))}
          </div>

          {/* Recent DANA Mutations Card — Matching "Mood History" */}
          <section className="bg-white border border-[#ECEEE6] rounded-[24px] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-[#171A1C]">Riwayat Mutasi QRIS</h2>
              <button
                type="button"
                aria-label="Lihat semua mutasi DANA Bisnis"
                onClick={() => onNavigate('mutations')}
                className="p-1 text-[#5E656E] hover:text-[#171A1C] rounded-full hover:bg-[#F5F6F1]"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2">
              {snapshot.mutations.slice(0, 5).map((mut, index) => {
                const tileColors = [
                  'bg-[#D6F163] text-[#1D2B07]',
                  'bg-[#9FD3F7] text-[#113A57]',
                  'bg-[#F7C7F9] text-[#4C1D56]',
                  'bg-[#FFE0D6] text-[#7D2B19]',
                  'bg-[#FDE68A] text-[#5C3D06]',
                ];
                const bg =
                  mut.status === 'MATCHED'
                    ? tileColors[index % 3]
                    : 'bg-[#FF8566] text-white';
                const initials = mut.senderName
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((s) => s[0])
                  .join('')
                  .toUpperCase();

                return (
                  <button
                    key={mut.id}
                    type="button"
                    onClick={() => onNavigate('mutations')}
                    title={`${mut.senderName} · ${formatRupiah(mut.amount)} (${formatDateTime(mut.receivedAt)})`}
                    className="flex flex-col items-center gap-1.5 group"
                  >
                    <span
                      className={`w-full aspect-square max-w-[48px] rounded-2xl flex items-center justify-center font-display text-xs font-bold transition-transform group-hover:scale-105 ${bg}`}
                    >
                      {initials || 'QR'}
                    </span>
                    <span className="text-[10px] font-mono text-[#5E656E] tabular-nums">
                      {formatCompactRp(mut.amount)}
                    </span>
                  </button>
                );
              })}

              {snapshot.mutations.length === 0 && (
                <p className="col-span-5 text-xs text-[#7D858E] text-center py-4">
                  Belum ada mutasi QRIS DANA Bisnis masuk.
                </p>
              )}
            </div>
          </section>

          {/* Interactive Radial QRIS & Gateway Dial — Matching "Daily Reflection" Wheel */}
          <section className="bg-white border border-[#ECEEE6] rounded-[28px] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold text-[#171A1C]">
                  Monitor Gateway QRIS
                </h2>
                <p className="text-xs text-[#6B727B] mt-0.5">
                  Pilih modul untuk cek status koneksi real-time.
                </p>
              </div>
              <button
                type="button"
                aria-label="Kelola QRIS dan template pesan"
                onClick={() => onNavigate('integration')}
                className="w-10 h-10 rounded-full bg-pastel-lavender text-[#3B1D47] hover:brightness-95 flex items-center justify-center shrink-0 transition-all"
              >
                <QrCode className="w-4 h-4" />
              </button>
            </div>

            {/* Orbiting Node Buttons */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              {(
                [
                  { id: 'qris', label: 'QRIS', bg: 'bg-[#D6F163] text-[#1D2B07]' },
                  { id: 'mutasi', label: 'Mutasi', bg: 'bg-[#A2D6F9] text-[#133D5A]' },
                  { id: 'email', label: 'Email', bg: 'bg-[#F7CCF9] text-[#4E1F58]' },
                  { id: 'wa', label: 'WA', bg: 'bg-[#FFE1A8] text-[#5C3D06]' },
                ] as const
              ).map((node) => {
                const selected = focusMetric === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setFocusMetric(node.id)}
                    className={`py-2 px-2 rounded-2xl text-[11px] font-bold transition-all ${node.bg} ${
                      selected
                        ? 'ring-2 ring-[#171A1C] scale-[1.03] shadow-xs'
                        : 'opacity-80 hover:opacity-100'
                    }`}
                  >
                    {node.label}
                  </button>
                );
              })}
            </div>

            {/* Radial Wheel Graphic */}
            <div className="flex flex-col items-center py-1">
              <div className="relative w-[204px] h-[204px] rounded-full border-[3px] border-[#CBE855] flex items-center justify-center bg-[#FCFDF9]">
                {/* Inner soft pastel quadrant ring */}
                <div
                  aria-hidden="true"
                  className="w-[108px] h-[108px] rounded-full p-2.5"
                  style={{
                    background:
                      'conic-gradient(#D9F36B 0deg 90deg, #F6C7FA 90deg 180deg, #FCE3B6 180deg 270deg, #B9E1FA 270deg 360deg)',
                  }}
                >
                  <div className="w-full h-full rounded-full bg-white flex flex-col items-center justify-center text-center px-1.5 shadow-2xs">
                    <span className="text-[10px] font-semibold text-[#7D858E]">
                      {activeDial.title}
                    </span>
                    <span className="font-display text-xs font-bold text-[#171A1C] mt-0.5 tabular-nums">
                      {activeDial.status}
                    </span>
                  </div>
                </div>

                {/* Compass labels */}
                <span className="absolute top-3 text-[9px] font-bold tracking-wide text-[#5E7C14]">
                  QRIS
                </span>
                <span className="absolute right-2.5 text-[9px] font-bold tracking-wide text-[#A648B6]">
                  EMAIL
                </span>
                <span className="absolute bottom-3 text-[9px] font-bold tracking-wide text-[#C45534]">
                  WA
                </span>
                <span className="absolute left-3.5 text-[9px] font-bold tracking-wide text-[#2A78A8]">
                  API
                </span>
              </div>

              <button
                type="button"
                onClick={() => onNavigate(activeDial.target)}
                className="mt-3 text-xs text-[#5E656E] hover:text-[#171A1C] underline-offset-2 hover:underline text-center"
              >
                {activeDial.helper}
              </button>
            </div>

            {/* Signature Lime-to-Pink Gradient Full-Width CTA Button */}
            <button
              type="button"
              onClick={() => onNavigate('checkout')}
              className="w-full py-3.5 px-6 rounded-full bg-pastel-cta text-sm font-display font-bold text-[#171A1C] inline-flex items-center justify-center gap-2 transition-all shadow-xs"
            >
              <span>Buat Checkout QRIS</span>
              <QrCode className="w-4 h-4" />
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
