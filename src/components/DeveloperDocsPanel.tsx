import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type { DashboardSnapshot } from '../types';
import { copyTextToClipboard } from '../lib/format';
import {
  buildHmacVerificationGuide,
  generateDynamicDeveloperDocs,
  type DynamicEndpointDoc,
  type EndpointCategory,
  type OpenApiSpec,
} from '../lib/developerDocs';

interface DeveloperDocsPanelProps {
  snapshot: DashboardSnapshot;
}

type CategoryFilter = 'ALL' | EndpointCategory;
type HmacLang = 'curl' | 'node' | 'php' | 'python';

const CATEGORY_OPTIONS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'ALL', label: 'Semua' },
  { id: 'Pembayaran & QRIS', label: 'Pembayaran & QRIS' },
  { id: 'Gateway & Channel', label: 'Gateway & Channel' },
  { id: 'Mutasi & Webhook', label: 'Mutasi & Webhook' },
];

const HMAC_LANG_OPTIONS: Array<{ id: HmacLang; label: string }> = [
  { id: 'curl', label: 'cURL + OpenSSL' },
  { id: 'node', label: 'Node.js' },
  { id: 'php', label: 'PHP / Laravel' },
  { id: 'python', label: 'Python' },
];

export function DeveloperDocsPanel({ snapshot }: DeveloperDocsPanelProps) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://app-anda.run.app';
  const apiBase = `${origin}/api/v1`;

  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);

  const [hmacLang, setHmacLang] = useState<HmacLang>('curl');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Live GET try-it state
  const [liveTryLoading, setLiveTryLoading] = useState(false);
  const [liveTryResult, setLiveTryResult] = useState<{
    endpointId: string;
    status: number;
    durationMs: number;
    body: string;
  } | null>(null);

  const loadSpec = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/openapi.json', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} saat memuat spesifikasi OpenAPI.`);
      }
      const data = (await res.json()) as OpenApiSpec;
      setSpec(data);
      setLastSyncedAt(
        new Date().toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Gagal memuat dokumentasi dinamis dari server.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpec();
  }, [loadSpec]);

  const endpoints = useMemo(() => {
    if (!spec) return [];
    return generateDynamicDeveloperDocs(spec, {
      baseUrl: origin,
      activeChannelId: snapshot.settings.activeQrisChannelId,
      externalApiKeyConfigured: snapshot.integration.externalApiKeyConfigured,
      webhookSecretConfigured: snapshot.integration.webhookSecretConfigured,
    });
  }, [
    spec,
    origin,
    snapshot.settings.activeQrisChannelId,
    snapshot.integration.externalApiKeyConfigured,
    snapshot.integration.webhookSecretConfigured,
  ]);

  const filteredEndpoints = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return endpoints.filter((ep) => {
      if (categoryFilter !== 'ALL' && ep.category !== categoryFilter) return false;
      if (!q) return true;
      const inFields = ep.bodyFields.some(
        (f) => f.name.toLowerCase().includes(q) || f.description.toLowerCase().includes(q)
      );
      return (
        ep.path.toLowerCase().includes(q) ||
        ep.method.toLowerCase().includes(q) ||
        ep.summary.toLowerCase().includes(q) ||
        inFields
      );
    });
  }, [endpoints, categoryFilter, searchQuery]);

  const selectedEndpoint: DynamicEndpointDoc | null = useMemo(() => {
    if (filteredEndpoints.length === 0) return null;
    if (selectedEndpointId) {
      const found = filteredEndpoints.find((ep) => ep.id === selectedEndpointId);
      if (found) return found;
    }
    return (
      filteredEndpoints.find((ep) => ep.method === 'POST' && ep.path === '/api/v1/payments') ??
      filteredEndpoints[0]
    );
  }, [filteredEndpoints, selectedEndpointId]);

  const hmacGuide = useMemo(() => buildHmacVerificationGuide(origin), [origin]);

  async function handleCopy(key: string, text: string) {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  async function handleTryGetEndpoint(ep: DynamicEndpointDoc) {
    setLiveTryLoading(true);
    const started = performance.now();
    try {
      const res = await fetch(ep.path);
      const text = await res.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // keep raw response text
      }
      setLiveTryResult({
        endpointId: ep.id,
        status: res.status,
        durationMs: Math.round(performance.now() - started),
        body: formatted,
      });
    } catch (err) {
      setLiveTryResult({
        endpointId: ep.id,
        status: 0,
        durationMs: Math.round(performance.now() - started),
        body: JSON.stringify(
          { error: err instanceof Error ? err.message : 'Request gagal' },
          null,
          2
        ),
      });
    } finally {
      setLiveTryLoading(false);
    }
  }

  const activeChannel = snapshot.qrisChannels.find(
    (ch) => ch.id === snapshot.settings.activeQrisChannelId
  );

  const canTryGet =
    selectedEndpoint !== null &&
    selectedEndpoint.method === 'GET' &&
    !selectedEndpoint.path.includes('{');

  return (
    <div className="space-y-5">
      {/* Dynamic OpenAPI Overview Header */}
      <section className="bg-pastel-lavender rounded-[28px] p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-[#171A1C]/10">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-full bg-white/85 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5 text-[#4B1D5C]" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-base font-bold text-[#171A1C]">
                  {spec?.info.title ?? 'MutasiPay External Developer Documentation'}
                </h2>
                {spec && (
                  <span className="text-[11px] font-mono font-semibold text-[#4B1D5C] bg-white/80 px-2.5 py-0.5 rounded-full">
                    OpenAPI {spec.openapi} · v{spec.info.version}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#3F2A4A] mt-1 leading-relaxed">
                Dokumentasi ini dihasilkan secara dinamis dari spesifikasi langsung{' '}
                <code className="font-mono">/api/v1/openapi.json</code> dengan Base URL dan channel QRIS aktif Anda.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadSpec()}
              disabled={loading}
              className="px-3.5 py-2 text-xs font-semibold text-[#171A1C] bg-white/85 hover:bg-white disabled:opacity-50 rounded-full transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Segarkan Spec
            </button>
            <a
              href="/api/v1/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 text-xs font-semibold text-[#171A1C] bg-white/85 hover:bg-white rounded-full transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              OpenAPI JSON
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button
              type="button"
              onClick={() => void handleCopy('docs-base-url', apiBase)}
              className="px-4 py-2 text-xs font-semibold text-[#D8F36A] bg-[#171A1C] hover:bg-[#2B3035] rounded-full transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {copiedKey === 'docs-base-url' ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Base URL Disalin
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Salin Base URL
                </>
              )}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          <div className="p-4 rounded-[20px] bg-white/85">
            <p className="text-[#5E656E]">Endpoint Eksternal Terdeteksi</p>
            <p className="mt-1 font-display text-lg font-bold text-[#171A1C] tabular-nums">
              {loading ? '...' : `${endpoints.length} Endpoint`}
            </p>
            <p className="mt-0.5 text-[#6B727B]">
              {lastSyncedAt ? `Sinkron OpenAPI pukul ${lastSyncedAt}` : 'Memuat skema server...'}
            </p>
          </div>
          <div className="p-4 rounded-[20px] bg-white/85">
            <p className="text-[#5E656E]">Channel QRIS Default pada cURL</p>
            <p className="mt-1 font-bold text-[#171A1C] truncate">
              {activeChannel ? `${activeChannel.label} (${activeChannel.providerName})` : snapshot.settings.activeQrisChannelId}
            </p>
            <p className="mt-0.5 font-mono text-[#6B727B] truncate">
              qris_channel_id: {snapshot.settings.activeQrisChannelId}
            </p>
          </div>
          <div className="p-4 rounded-[20px] bg-white/85">
            <p className="text-[#5E656E]">Header Autentikasi & Webhook</p>
            <p className="mt-1 font-bold text-[#171A1C]">
              {snapshot.integration.externalApiKeyConfigured
                ? 'Bearer API Key Aktif'
                : 'Mode Dev (Set EXTERNAL_API_KEY)'}
            </p>
            <p className="mt-0.5 font-mono text-[#6B727B]">
              HMAC-SHA256 · X-MutasiPay-Signature
            </p>
          </div>
        </div>
      </section>

      {/* Dynamic External Endpoints Explorer */}
      <section className="bg-white border border-[#ECEEE6] rounded-[28px] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#F2F3EE] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-[#171A1C]">
              Referensi Endpoint Eksternal (Dinamis)
            </h3>
            <p className="text-xs text-[#6B727B] mt-0.5">
              Pilih endpoint untuk melihat parameter, skema JSON body, dan contoh perintah cURL siap tempel.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-[#8A929C] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Cari endpoint atau field"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari endpoint / field..."
                className="w-full sm:w-52 pl-9 pr-3.5 py-2 text-xs bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-full text-[#171A1C] focus:outline-none transition-colors"
              />
            </div>

            <div
              className="flex flex-wrap items-center gap-1 p-1 bg-[#F5F6F2] rounded-full"
              role="tablist"
              aria-label="Filter kategori endpoint"
            >
              {CATEGORY_OPTIONS.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={categoryFilter === cat.id}
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-3 py-1 text-[11px] font-medium rounded-full transition-all whitespace-nowrap ${
                    categoryFilter === cat.id
                      ? 'bg-white border border-[#CBE855] text-[#171A1C] font-semibold shadow-2xs'
                      : 'text-[#5E656E] hover:text-[#171A1C]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-[#FFE4DE] text-[#C83E2B] mx-auto flex items-center justify-center">
              <AlertCircle className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-[#C83E2B]">{error}</p>
            <button
              type="button"
              onClick={() => void loadSpec()}
              className="px-4 py-2 text-xs font-semibold text-[#171A1C] bg-pastel-cta rounded-full"
            >
              Coba Muat Ulang Spec
            </button>
          </div>
        ) : loading && !spec ? (
          <div className="p-8 text-center text-xs text-[#6B727B]">
            Memuat spesifikasi OpenAPI 3.0 dari server...
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#F2F3EE]">
            {/* Left Endpoint Index */}
            <div className="lg:col-span-4 divide-y divide-[#F2F3EE] max-h-[680px] overflow-y-auto">
              {filteredEndpoints.map((ep) => {
                const isSelected = selectedEndpoint?.id === ep.id;
                return (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => {
                      setSelectedEndpointId(ep.id);
                      if (liveTryResult && liveTryResult.endpointId !== ep.id) {
                        setLiveTryResult(null);
                      }
                    }}
                    className={`w-full text-left px-5 py-4 transition-colors ${
                      isSelected ? 'bg-[#F8FDE8]' : 'hover:bg-[#FAFBF8]'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-mono text-xs">
                      <span
                        className={`font-bold shrink-0 ${
                          ep.method === 'GET' ? 'text-[#3C6E14]' : 'text-[#7E2FA0]'
                        }`}
                      >
                        {ep.method}
                      </span>
                      <span className="font-semibold text-[#171A1C] truncate">{ep.path}</span>
                    </div>
                    <p className="text-[11px] text-[#6B727B] mt-1 leading-snug line-clamp-2">
                      {ep.summary}
                    </p>
                  </button>
                );
              })}

              {filteredEndpoints.length === 0 && (
                <div className="p-6 text-center text-xs text-[#6B727B]">
                  Tidak ada endpoint yang cocok dengan pencarian &ldquo;{searchQuery}&rdquo;.
                </div>
              )}
            </div>

            {/* Right Endpoint Detail & Generated cURL */}
            <div className="lg:col-span-8 p-6 space-y-5">
              {selectedEndpoint ? (
                <>
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-[#F2F3EE]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-mono text-sm">
                        <span
                          className={`px-2.5 py-0.5 rounded-lg text-xs font-bold ${
                            selectedEndpoint.method === 'GET'
                              ? 'bg-[#EAF8C6] text-[#3C6E14]'
                              : 'bg-[#F4E6FC] text-[#7E2FA0]'
                          }`}
                        >
                          {selectedEndpoint.method}
                        </span>
                        <span className="font-bold text-[#171A1C] break-all">
                          {selectedEndpoint.path}
                        </span>
                      </div>
                      <p className="text-xs text-[#4B525A] mt-2 leading-relaxed">
                        {selectedEndpoint.summary}
                      </p>
                      <p className="text-[11px] font-mono text-[#6B727B] mt-1.5">
                        Autentikasi: <span className="text-[#171A1C] font-semibold">{selectedEndpoint.authLabel}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canTryGet && (
                        <button
                          type="button"
                          disabled={liveTryLoading}
                          onClick={() => void handleTryGetEndpoint(selectedEndpoint)}
                          className="px-3.5 py-2 text-xs font-semibold text-[#171A1C] bg-pastel-cta disabled:opacity-50 rounded-full inline-flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Play className="w-3.5 h-3.5" />
                          {liveTryLoading ? 'Memanggil...' : 'Coba GET Live'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleCopy(`url-${selectedEndpoint.id}`, selectedEndpoint.fullUrl)}
                        className="px-3.5 py-2 text-xs font-semibold text-[#171A1C] bg-[#F5F6F2] hover:bg-[#ECEEE6] rounded-full inline-flex items-center gap-1.5 whitespace-nowrap"
                      >
                        {copiedKey === `url-${selectedEndpoint.id}` ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-[#3C6E14]" />
                            URL Disalin
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Salin URL
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Live GET Result Preview */}
                  {liveTryResult && liveTryResult.endpointId === selectedEndpoint.id && (
                    <div className="space-y-2 p-4 rounded-2xl bg-[#FAFBF8] border border-[#ECEEE6]">
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span
                          className={
                            liveTryResult.status >= 200 && liveTryResult.status < 300
                              ? 'text-[#3C6E14] font-bold'
                              : 'text-[#C83E2B] font-bold'
                          }
                        >
                          Respon Live · HTTP {liveTryResult.status}
                        </span>
                        <span className="text-[#6B727B] tabular-nums">{liveTryResult.durationMs} ms</span>
                      </div>
                      <pre className="p-3.5 bg-[#171A1C] text-[#F1F5EE] rounded-xl text-[11px] font-mono overflow-x-auto max-h-56 overflow-y-auto leading-relaxed">
                        {liveTryResult.body}
                      </pre>
                    </div>
                  )}

                  {/* Parameters Table */}
                  {selectedEndpoint.parameters.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-[#171A1C]">
                        Parameter Path & Query
                      </h4>
                      <div className="overflow-x-auto rounded-2xl border border-[#F2F3EE]">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-[#FAFBF8] border-b border-[#F2F3EE] text-[#6B727B]">
                              <th className="py-2.5 px-4 font-semibold">Parameter</th>
                              <th className="py-2.5 px-3 font-semibold">Lokasi</th>
                              <th className="py-2.5 px-3 font-semibold">Tipe</th>
                              <th className="py-2.5 px-4 font-semibold">Keterangan</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F2F3EE]">
                            {selectedEndpoint.parameters.map((param) => (
                              <tr key={`${param.in}-${param.name}`}>
                                <td className="py-2.5 px-4 font-mono font-semibold text-[#171A1C]">
                                  {param.name}
                                  {param.required && (
                                    <span className="ml-1.5 text-[10px] text-[#C83E2B] font-sans font-bold">
                                      Wajib
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[#5E656E]">{param.in}</td>
                                <td className="py-2.5 px-3 font-mono text-[#5E656E]">
                                  {param.schema?.type ?? 'string'}
                                </td>
                                <td className="py-2.5 px-4 text-[#5E656E]">
                                  {param.description || '-'}
                                  {param.schema?.enum && (
                                    <span className="block font-mono text-[11px] text-[#7E2FA0] mt-0.5">
                                      Nilai: {param.schema.enum.join(' | ')}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Request Body Schema Table */}
                  {selectedEndpoint.bodyFields.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-[#171A1C]">
                        Skema Request Body (application/json)
                      </h4>
                      <div className="overflow-x-auto rounded-2xl border border-[#F2F3EE]">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-[#FAFBF8] border-b border-[#F2F3EE] text-[#6B727B]">
                              <th className="py-2.5 px-4 font-semibold">Field</th>
                              <th className="py-2.5 px-3 font-semibold">Tipe</th>
                              <th className="py-2.5 px-3 font-semibold">Contoh</th>
                              <th className="py-2.5 px-4 font-semibold">Keterangan</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F2F3EE]">
                            {selectedEndpoint.bodyFields.map((field) => (
                              <tr key={field.name}>
                                <td className="py-2.5 px-4 font-mono font-semibold text-[#171A1C] whitespace-nowrap">
                                  {field.name}
                                  {field.required ? (
                                    <span className="ml-1.5 text-[10px] text-[#C83E2B] font-sans font-bold">
                                      Wajib
                                    </span>
                                  ) : (
                                    <span className="ml-1.5 text-[10px] text-[#8A929C] font-sans">
                                      Opsional
                                    </span>
                                  )}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[#5E656E] whitespace-nowrap">
                                  {field.type}
                                </td>
                                <td className="py-2.5 px-3 font-mono text-[11px] text-[#3C6E14] max-w-[180px] truncate">
                                  {field.example}
                                </td>
                                <td className="py-2.5 px-4 text-[#5E656E] leading-snug">
                                  {field.description || '-'}
                                  {field.enumValues && field.enumValues.length > 0 && (
                                    <span className="block font-mono text-[11px] text-[#7E2FA0] mt-0.5">
                                      Enum: {field.enumValues.join(' | ')}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Dynamically Generated cURL Example */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-[#171A1C] inline-flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-[#3C6E14]" aria-hidden="true" />
                        Contoh cURL (Dibuat Dinamis)
                      </h4>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopy(`curl-${selectedEndpoint.id}`, selectedEndpoint.curlExample)
                        }
                        className="px-3 py-1 text-xs font-semibold text-[#171A1C] bg-[#D8F36A] hover:bg-[#CBE855] rounded-full inline-flex items-center gap-1.5 transition-colors"
                      >
                        {copiedKey === `curl-${selectedEndpoint.id}` ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            cURL Disalin
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            Salin cURL
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-4 bg-[#171A1C] text-[#F1F5EE] rounded-2xl text-xs font-mono leading-relaxed overflow-x-auto">
                      {selectedEndpoint.curlExample}
                    </pre>
                  </div>

                  {/* Responses Summary */}
                  {selectedEndpoint.responses.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-bold text-[#171A1C]">Kode Respon HTTP</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {selectedEndpoint.responses.map((resp) => (
                          <div
                            key={resp.status}
                            className="px-3.5 py-2.5 rounded-2xl bg-[#F6F7F4] flex items-center gap-2.5"
                          >
                            <span
                              className={`font-mono font-bold ${
                                resp.status.startsWith('2')
                                  ? 'text-[#3C6E14]'
                                  : 'text-[#C83E2B]'
                              }`}
                            >
                              {resp.status}
                            </span>
                            <span className="text-[#4B525A]">{resp.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-12 text-center text-xs text-[#6B727B]">
                  Pilih salah satu endpoint di panel kiri untuk melihat detail & contoh cURL.
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* HMAC-SHA256 Webhook Signature Verification Guide */}
      <section className="bg-white border border-[#ECEEE6] rounded-[28px] overflow-hidden">
        <div className="px-6 py-5 border-b border-[#F2F3EE] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-full bg-pastel-lime flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-[#171A1C]" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-[#171A1C]">
                Panduan Verifikasi Signature HMAC-SHA256 Webhook
              </h3>
              <p className="text-xs text-[#6B727B] mt-0.5">
                Setiap webhook keluar (<code className="font-mono">payment.paid</code>,{' '}
                <code className="font-mono">payment.created</code>,{' '}
                <code className="font-mono">mutation.received</code>) ditandatangani dengan{' '}
                <code className="font-mono">OUTBOUND_WEBHOOK_SECRET</code> agar server Anda dapat memastikan keaslian request.
              </p>
            </div>
          </div>

          <div
            className="flex flex-wrap sm:flex-nowrap items-center gap-1 p-1 bg-[#F5F6F2] rounded-full w-fit shrink-0"
            role="tablist"
            aria-label="Bahasa verifikasi HMAC"
          >
            {HMAC_LANG_OPTIONS.map((lang) => (
              <button
                key={lang.id}
                type="button"
                role="tab"
                aria-selected={hmacLang === lang.id}
                onClick={() => setHmacLang(lang.id)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition-all whitespace-nowrap ${
                  hmacLang === lang.id
                    ? 'bg-white border border-[#CBE855] text-[#171A1C] font-semibold shadow-2xs'
                    : 'text-[#5E656E] hover:text-[#171A1C]'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* 3-Step Verification Instructions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-4 rounded-2xl bg-[#F6F7F4] space-y-1.5">
              <p className="font-mono font-bold text-[#3C6E14]">Langkah 1 · Baca Raw Body</p>
              <p className="text-[#4B525A] leading-relaxed">
                Ambil body HTTP mentah persis seperti yang dikirim (jangan di-parse lalu{' '}
                <code className="font-mono">JSON.stringify</code> ulang karena perubahan spasi akan membatalkan HMAC).
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-[#F6F7F4] space-y-1.5">
              <p className="font-mono font-bold text-[#7E2FA0]">Langkah 2 · Cek Replay Window</p>
              <p className="text-[#4B525A] leading-relaxed">
                Pastikan selisih waktu server Anda dengan header{' '}
                <code className="font-mono">X-MutasiPay-Timestamp</code> tidak lebih dari{' '}
                <strong className="text-[#171A1C]">300 detik (5 menit)</strong>.
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-[#F6F7F4] space-y-1.5">
              <p className="font-mono font-bold text-[#171A1C]">Langkah 3 · Bandingkan Constant-Time</p>
              <p className="text-[#4B525A] leading-relaxed">
                Hitung HMAC-SHA256 atas string{' '}
                <code className="font-mono font-semibold text-[#171A1C]">
                  {hmacGuide.signedPayloadFormula}
                </code>{' '}
                dan bandingkan dengan <code className="font-mono">timingSafeEqual</code> /{' '}
                <code className="font-mono">hash_equals</code>.
              </p>
            </div>
          </div>

          {/* Formula + Headers Reference */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <div className="lg:col-span-5 space-y-3">
              <div className="p-4 rounded-2xl bg-[#FAFBF8] border border-[#ECEEE6] text-xs space-y-1.5">
                <p className="font-semibold text-[#3C424A]">Algoritma & Format Signing</p>
                <p className="text-[#5E656E]">{hmacGuide.algorithm}</p>
                <div className="mt-2 p-2.5 rounded-xl bg-white border border-[#ECEEE6] font-mono text-[11px] text-[#171A1C] overflow-x-auto whitespace-nowrap">
                  signature = &quot;sha256=&quot; + HMAC_SHA256(secret, &quot;{hmacGuide.signedPayloadFormula}&quot;)
                </div>
              </div>

              <div className="rounded-2xl border border-[#F2F3EE] overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#FAFBF8] border-b border-[#F2F3EE] text-[#6B727B]">
                      <th className="py-2.5 px-4 font-semibold">Header Webhook</th>
                      <th className="py-2.5 px-4 font-semibold">Fungsi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F2F3EE]">
                    {hmacGuide.headers.map((h) => (
                      <tr key={h.name}>
                        <td className="py-2.5 px-4 font-mono text-[11px] font-semibold text-[#171A1C] align-top whitespace-nowrap">
                          {h.name}
                          <span className="block font-normal text-[#8A929C] mt-0.5">
                            {h.example}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-[#5E656E] leading-snug">{h.purpose}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Copyable HMAC Verification Code Snippet */}
            <div className="lg:col-span-7 bg-[#171A1C] text-[#F1F5EE] rounded-2xl p-5 flex flex-col">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10 text-xs">
                <span className="font-mono text-[#A8B1A2]">
                  {hmacLang === 'curl'
                    ? 'Uji Signature HMAC-SHA256 via cURL + OpenSSL'
                    : hmacLang === 'node'
                      ? 'Verifikasi HMAC-SHA256 · Node.js (Express / Next.js)'
                      : hmacLang === 'php'
                        ? 'Verifikasi HMAC-SHA256 · PHP / Laravel'
                        : 'Verifikasi HMAC-SHA256 · Python (FastAPI)'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopy(`hmac-${hmacLang}`, hmacGuide.snippets[hmacLang])}
                  className="px-3 py-1 text-xs font-semibold text-[#171A1C] bg-[#D8F36A] hover:bg-[#CBE855] rounded-full inline-flex items-center gap-1.5 transition-colors"
                >
                  {copiedKey === `hmac-${hmacLang}` ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Disalin
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Salin Kode
                    </>
                  )}
                </button>
              </div>
              <pre className="text-xs font-mono leading-relaxed overflow-x-auto">
                {hmacGuide.snippets[hmacLang]}
              </pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
