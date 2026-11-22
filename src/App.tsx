import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Home,
  Menu,
  Package,
  ReceiptText,
  Settings2,
  ShoppingBag,
  Webhook,
  X,
  LogOut,
} from 'lucide-react';
import type { DashboardSnapshot, OrderRecord } from './types';
import { parseQrisMetadata } from './lib/qris';
import { resolveActiveChannel } from './lib/qrisChannels';
import { OverviewView } from './components/OverviewView';
import { MutationsView } from './components/MutationsView';
import { OrdersView } from './components/OrdersView';
import { ProductsView } from './components/ProductsView';
import { CheckoutView } from './components/CheckoutView';
import { IntegrationView } from './components/IntegrationView';
import { ApiWebhookView } from './components/ApiWebhookView';
import { HostedPayView } from './components/HostedPayView';
import { LoginPortal } from './components/LoginPortal';

export type TabKey =
  | 'overview'
  | 'mutations'
  | 'orders'
  | 'products'
  | 'checkout'
  | 'api'
  | 'integration';

const CENTER_NAV_ITEMS: Array<{
  id: TabKey;
  label: string;
  breadcrumb: string;
  icon: typeof Home;
}> = [
  { id: 'overview', label: 'Ringkasan', breadcrumb: 'Ringkasan', icon: Home },
  { id: 'mutations', label: 'Mutasi QRIS', breadcrumb: 'Mutasi Multi-QRIS', icon: Activity },
  {
    id: 'orders',
    label: 'Pesanan & Akses',
    breadcrumb: 'Pesanan & Pengiriman Akses',
    icon: ReceiptText,
  },
  { id: 'products', label: 'Produk Digital', breadcrumb: 'Katalog Produk Digital', icon: Package },
  {
    id: 'api',
    label: 'API & Webhook',
    breadcrumb: 'REST API v1 & Outbound Webhook',
    icon: Webhook,
  },
];

const ALL_NAV_ITEMS: Array<{
  id: TabKey;
  label: string;
  breadcrumb: string;
  icon: typeof Home;
}> = [
  ...CENTER_NAV_ITEMS,
  { id: 'checkout', label: 'Checkout Pembeli', breadcrumb: 'Checkout Pembeli', icon: ShoppingBag },
  {
    id: 'integration',
    label: 'QRIS & Template',
    breadcrumb: 'Pengaturan QRIS & Template',
    icon: Settings2,
  },
];

function getInitialHostedPayCode(): string | null {
  if (typeof window === 'undefined') return null;
  const fromQuery = new URLSearchParams(window.location.search).get('pay')?.trim();
  if (fromQuery) return fromQuery;
  const pathMatch = window.location.pathname.match(/^\/pay\/([^/]+)/);
  return pathMatch ? decodeURIComponent(pathMatch[1]) : null;
}

export default function App() {
  const initialCheckoutParam =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('checkout')
      : null;

  const [hostedPayCode, setHostedPayCode] = useState<string | null>(getInitialHostedPayCode);
  const [activeTab, setActiveTab] = useState<TabKey>(initialCheckoutParam ? 'checkout' : 'overview');
  const [checkoutProductId, setCheckoutProductId] = useState<string | null>(initialCheckoutParam);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Authentication State
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [_userEmail, setUserEmail] = useState<string | null>(null);

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [simulatingId, setSimulatingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('mutasipay_session_token') : null;
      const res = await fetch('/api/snapshot', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('mutasipay_session_token');
        }
        setIsAuthenticated(false);
        return;
      }
      if (!res.ok) throw new Error('Gagal memuat data server.');
      const data = (await res.json()) as DashboardSnapshot;
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Global Auth Check & Fetch Interceptor
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check existing session
    const token = localStorage.getItem('mutasipay_session_token');
    if (!token) {
      setIsAuthenticated(false);
      setAuthChecked(true);
      setLoading(false);
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.authenticated) {
          setIsAuthenticated(true);
          setUserEmail(data.user?.email || 'digitalproductoneclub@gmail.com');
          fetchSnapshot();
        } else {
          localStorage.removeItem('mutasipay_session_token');
          setIsAuthenticated(false);
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
      })
      .finally(() => {
        setAuthChecked(true);
      });
  }, [fetchSnapshot]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const token = typeof window !== 'undefined' ? localStorage.getItem('mutasipay_session_token') : null;
    const eventSource = new EventSource(`/api/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);
    eventSource.addEventListener('snapshot', (ev) => {
      try {
        const next = JSON.parse((ev as MessageEvent).data) as DashboardSnapshot;
        setSnapshot(next);
      } catch {
        // Ignore malformed SSE frames
      }
    });
    eventSource.addEventListener('order_paid', (ev) => {
      try {
        const paid = JSON.parse((ev as MessageEvent).data) as OrderRecord;
        setToast(
          `Pembayaran ${paid.orderCode} (${paid.buyerName}) terverifikasi otomatis. Akses Email & WhatsApp dikirim.`
        );
      } catch {
        // Ignore
      }
    });

    return () => {
      eventSource.close();
    };
  }, [isAuthenticated, fetchSnapshot]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSimulateOrderPayment(order: OrderRecord) {
    setSimulatingId(order.id);
    try {
      const formattedNominal = new Intl.NumberFormat('id-ID').format(order.totalAmount);
      const orderChannel = snapshot
        ? resolveActiveChannel(
            snapshot.qrisChannels,
            order.qrisChannelId,
            snapshot.settings.activeQrisChannelId
          )
        : null;
      const isNeo = orderChannel?.provider === 'NEOBANK';
      await fetch('/api/simulate/dana-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `${orderChannel?.providerName ?? 'DANA Bisnis'} — Pembayaran QRIS`,
          message: isNeo
            ? `Anda menerima pembayaran QRIS sebesar Rp ${formattedNominal} dari ${order.buyerName.toUpperCase()} di Neobank`
            : `Kamu baru saja menerima pembayaran Rp ${formattedNominal} melalui QRIS dari ${order.buyerName.toUpperCase()}`,
          senderName: order.buyerName.toUpperCase(),
          packageName: orderChannel?.packageName ?? 'id.dana.merchant',
        }),
      });
      await fetchSnapshot();
    } finally {
      setSimulatingId(null);
    }
  }

  async function handleLogout() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('mutasipay_session_token') : null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('mutasipay_session_token');
      document.cookie = 'mutasipay_session_token=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    }
    setIsAuthenticated(false);
    setSnapshot(null);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {}
  }

  function handleExitHostedPay() {
    setHostedPayCode(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', '/');
    }
  }

  if (hostedPayCode) {
    return <HostedPayView orderCode={hostedPayCode} onExitToDashboard={handleExitHostedPay} />;
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#EAEDE1] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#0F172A] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-bold text-[#555C62] uppercase tracking-wider">Memverifikasi Keamanan Portal...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <LoginPortal
        onLoginSuccess={() => {
          setIsAuthenticated(true);
          setAuthChecked(true);
          fetchSnapshot();
        }}
      />
    );
  }

  function handleNavigate(tab: TabKey) {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  }

  function handleOpenProductCheckout(productId: string) {
    setCheckoutProductId(productId);
    setActiveTab('checkout');
    setMobileMenuOpen(false);
  }

  function handleSelectOrderFromOverview(orderId: string) {
    setSelectedOrderId(orderId);
    setActiveTab('orders');
    setMobileMenuOpen(false);
  }

  const activeChannel = snapshot
    ? resolveActiveChannel(snapshot.qrisChannels, null, snapshot.settings.activeQrisChannelId)
    : null;
  const merchantMeta = activeChannel
    ? parseQrisMetadata(activeChannel.staticQris)
    : snapshot
      ? parseQrisMetadata(snapshot.settings.staticQris)
      : null;
  const activeNavItem = ALL_NAV_ITEMS.find((n) => n.id === activeTab) ?? ALL_NAV_ITEMS[0];
  const pendingCount = snapshot ? snapshot.orders.filter((o) => o.status === 'PENDING').length : 0;
  const merchantInitials = (merchantMeta?.merchantName ?? 'AYAM PETOK-PETOK')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <div className="min-h-screen bg-[#EAEDE1] text-[#171A1C] py-2.5 px-2.5 sm:py-5 sm:px-5 lg:py-6 lg:px-7">
      {/* Main Floating White Shell */}
      <div className="max-w-[1380px] mx-auto bg-white rounded-[26px] sm:rounded-[34px] shadow-bento-shell min-h-[calc(100vh-3rem)] flex flex-col overflow-hidden">
        {/* Top Navigation Bar — Exact 3-zone floating header matching reference */}
        <header className="px-4 sm:px-7 lg:px-9 h-[72px] sm:h-[80px] flex items-center justify-between gap-4 border-b border-[#F2F3EE] shrink-0">
          {/* Zone 1: Pastel Organic Brand Lockup */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              aria-label="Buka menu navigasi"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="w-10 h-10 rounded-full bg-[#F6F7F3] hover:bg-[#ECEEE6] text-[#171A1C] flex items-center justify-center md:hidden transition-colors"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('overview')}
              className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CBE855] rounded-full pr-1"
            >
              <svg
                width="34"
                height="34"
                viewBox="0 0 36 36"
                fill="none"
                aria-hidden="true"
                className="shrink-0 transition-transform duration-200 group-hover:scale-105"
              >
                <circle
                  cx="18"
                  cy="11.5"
                  r="6"
                  stroke="#E5B6F7"
                  strokeWidth="2.4"
                  fill="#FBF0FF"
                />
                <circle
                  cx="12"
                  cy="22"
                  r="6.2"
                  stroke="#CBE855"
                  strokeWidth="2.4"
                  fill="#F7FDE4"
                />
                <circle
                  cx="24"
                  cy="22"
                  r="6.2"
                  stroke="#F1B8F8"
                  strokeWidth="2.4"
                  fill="#FFF2FE"
                />
              </svg>
              <span className="font-display text-lg font-bold tracking-tight text-[#171A1C] inline-flex items-center">
                <span>Mutasi</span>
                <span className="ml-0.5 px-2 py-0.5 rounded-full bg-pastel-cta text-[#171A1C] font-bold">
                  Pay
                </span>
              </span>
            </button>
          </div>

          {/* Zone 2: Centered Circular Icon Navigation */}
          <nav
            aria-label="Navigasi utama"
            className="hidden md:flex items-center gap-2.5 lg:gap-4"
          >
            {CENTER_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.label}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => handleNavigate(item.id)}
                  className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CBE855] ${
                    isActive
                      ? 'bg-pastel-circle text-[#171A1C] shadow-xs'
                      : 'text-[#4B525A] hover:bg-[#F5F6F1] hover:text-[#171A1C]'
                  }`}
                >
                  <Icon className="w-[19px] h-[19px]" strokeWidth={isActive ? 2.15 : 1.85} />
                  {item.id === 'orders' && pendingCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#171A1C] text-[#D9F46E] text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Right Utility Action Circles (Avatar / Checkout / Alerts) */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              title={`QRIS & Template · ${merchantMeta?.merchantName ?? 'AYAM PETOK-PETOK'}`}
              aria-label="Pengaturan QRIS & Template"
              onClick={() => handleNavigate('integration')}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-display font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CBE855] ${
                activeTab === 'integration'
                  ? 'bg-pastel-circle text-[#171A1C] ring-2 ring-[#CBE855]'
                  : 'bg-[#F5D8FF] text-[#2A1B33] hover:brightness-95'
              }`}
            >
              {merchantInitials}
            </button>

            <button
              type="button"
              title="Checkout Pembeli (Buat QRIS Dinamis)"
              aria-label="Checkout Pembeli"
              onClick={() => handleNavigate('checkout')}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CBE855] ${
                activeTab === 'checkout'
                  ? 'bg-pastel-circle text-[#171A1C] shadow-xs'
                  : 'bg-[#F6F7F3] text-[#171A1C] hover:bg-[#ECEEE6]'
              }`}
            >
              <ShoppingBag className="w-[18px] h-[18px]" strokeWidth={1.9} />
            </button>

            <button
              type="button"
              title={
                pendingCount > 0
                  ? `${pendingCount} tagihan menunggu pembayaran QRIS`
                  : 'Lihat Mutasi & Pesanan'
              }
              aria-label="Lihat tagihan menunggu dan mutasi"
              onClick={() => handleNavigate(pendingCount > 0 ? 'orders' : 'mutations')}
              className="relative w-10 h-10 rounded-full bg-[#F6F7F3] hover:bg-[#ECEEE6] text-[#171A1C] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#CBE855]"
            >
              <Bell className="w-[18px] h-[18px]" strokeWidth={1.9} />
              {pendingCount > 0 && (
                <span className="absolute top-2 right-2.5 w-2 h-2 rounded-full bg-[#FF6E4E]" />
              )}
            </button>

            {/* Logout Button */}
            <button
              type="button"
              title="Kunci Gateway & Keluar (Logout)"
              aria-label="Logout"
              onClick={handleLogout}
              className="w-10 h-10 rounded-full bg-[#F6F7F3] hover:bg-rose-50 text-slate-500 hover:text-rose-600 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 cursor-pointer"
            >
              <LogOut className="w-[18px] h-[18px]" strokeWidth={1.9} />
            </button>
          </div>
        </header>

        {/* Mobile Navigation Sheet */}
        {mobileMenuOpen && (
          <nav
            aria-label="Navigasi seluler"
            className="md:hidden px-4 py-3 bg-[#FAFBF8] border-b border-[#ECEEE6] grid grid-cols-2 gap-2"
          >
            {ALL_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-pastel-cta text-[#171A1C]'
                      : 'bg-white border border-[#ECEEE6] text-[#4B525A]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 transition-colors whitespace-nowrap cursor-pointer col-span-2 justify-center"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Keluar / Kunci Gateway</span>
            </button>
          </nav>
        )}

        {/* Live Real-Time Toast Banner */}
        {toast && (
          <div
            role="status"
            className="mx-4 sm:mx-7 lg:mx-9 mt-4 px-5 py-3 bg-[#F1FBE0] border border-[#D4EF65] rounded-2xl flex items-center justify-between gap-4 text-xs text-[#1E2B0D]"
          >
            <p className="font-medium">{toast}</p>
            <button
              type="button"
              aria-label="Tutup notifikasi"
              onClick={() => setToast(null)}
              className="text-[#3C5119] hover:text-[#171A1C] shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Contextual Sub-Header Bar for Inner Workspace Views */}
        {activeTab !== 'overview' && (
          <div className="px-4 sm:px-7 lg:px-9 pt-6 pb-1 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl sm:text-[26px] font-bold tracking-tight text-[#171A1C]">
                {activeNavItem.breadcrumb}
              </h1>
              <p className="text-xs text-[#6B727B] mt-0.5">
                {merchantMeta?.merchantName ?? 'AYAM PETOK-PETOK'} · NMID{' '}
                <span className="font-mono tabular-nums">
                  {merchantMeta?.nmid ?? 'ID1025451598425'}
                </span>{' '}
                · {activeChannel?.providerName ?? 'DANA Bisnis'} ({snapshot?.qrisChannels.length ?? 1} QRIS)
              </p>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {ALL_NAV_ITEMS.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`px-4 py-2 rounded-full text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-white border border-[#CBE855] text-[#171A1C] font-semibold shadow-2xs'
                        : 'bg-[#F6F7F3] border border-transparent text-[#5E656E] hover:text-[#171A1C] hover:bg-[#ECEEE6]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Viewport Content */}
        <main className="flex-1 px-4 sm:px-7 lg:px-9 py-5 sm:py-6">
          {loading && !snapshot ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-4 h-80 bg-[#F6F7F3] rounded-[28px] animate-pulse" />
              <div className="lg:col-span-4 h-80 bg-[#F6F7F3] rounded-[28px] animate-pulse" />
              <div className="lg:col-span-4 h-80 bg-[#F6F7F3] rounded-[28px] animate-pulse" />
            </div>
          ) : error && !snapshot ? (
            <div className="bg-[#FAFBF8] border border-[#ECEEE6] rounded-[28px] p-10 text-center">
              <p className="text-sm font-medium text-[#C83E2B]">{error}</p>
              <button
                type="button"
                onClick={fetchSnapshot}
                className="mt-4 px-6 py-2.5 text-xs font-semibold text-[#171A1C] bg-pastel-cta rounded-full transition-all"
              >
                Muat Ulang Data
              </button>
            </div>
          ) : snapshot ? (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  snapshot={snapshot}
                  onNavigate={handleNavigate}
                  onSimulateOrderPayment={handleSimulateOrderPayment}
                  onSelectOrder={handleSelectOrderFromOverview}
                  simulatingId={simulatingId}
                />
              )}
              {activeTab === 'mutations' && (
                <MutationsView snapshot={snapshot} onRefresh={fetchSnapshot} />
              )}
              {activeTab === 'orders' && (
                <OrdersView
                  snapshot={snapshot}
                  selectedOrderId={selectedOrderId}
                  onSelectOrder={setSelectedOrderId}
                  onRefresh={fetchSnapshot}
                  onSimulateOrderPayment={handleSimulateOrderPayment}
                  simulatingId={simulatingId}
                />
              )}
              {activeTab === 'products' && (
                <ProductsView
                  snapshot={snapshot}
                  onRefresh={fetchSnapshot}
                  onOpenCheckout={handleOpenProductCheckout}
                />
              )}
              {activeTab === 'checkout' && (
                <CheckoutView
                  snapshot={snapshot}
                  initialProductId={checkoutProductId}
                  onOrderCreated={fetchSnapshot}
                  onSimulateOrderPayment={handleSimulateOrderPayment}
                  simulatingId={simulatingId}
                />
              )}
              {activeTab === 'api' && (
                <ApiWebhookView snapshot={snapshot} onRefresh={fetchSnapshot} />
              )}
              {activeTab === 'integration' && (
                <IntegrationView snapshot={snapshot} onRefresh={fetchSnapshot} />
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
