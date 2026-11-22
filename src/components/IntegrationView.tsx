import { useState, type FormEvent } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { DashboardSnapshot, QrisChannel, QrisProvider } from '../types';
import { parseQrisMetadata } from '../lib/qris';
import {
  QRIS_PROVIDER_PRESETS,
  detectProviderFromQris,
  getProviderPreset,
  maskQrisPayload,
  resolveActiveChannel,
} from '../lib/qrisChannels';
import { copyTextToClipboard } from '../lib/format';

interface IntegrationViewProps {
  snapshot: DashboardSnapshot;
  onRefresh: () => Promise<void>;
}

export function IntegrationView({ snapshot, onRefresh }: IntegrationViewProps) {
  const activeChannel = resolveActiveChannel(
    snapshot.qrisChannels,
    null,
    snapshot.settings.activeQrisChannelId
  );

  // Add New Locked QRIS Channel Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState<QrisProvider>('NEOBANK');
  const [newLabel, setNewLabel] = useState('');
  const [newPackageName, setNewPackageName] = useState(
    getProviderPreset('NEOBANK').defaultPackageName
  );
  const [newStaticQris, setNewStaticQris] = useState('');
  const [setAsActiveOnSave, setSetAsActiveOnSave] = useState(true);
  const [addingChannel, setAddingChannel] = useState(false);
  const [channelFeedback, setChannelFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revealedPayloads, setRevealedPayloads] = useState<Record<string, boolean>>({});

  // Template & Expiry Settings State (never touches locked QRIS payloads)
  const [expiryMinutes, setExpiryMinutes] = useState(String(snapshot.settings.expiryMinutes));
  const [autoFulfillEnabled, setAutoFulfillEnabled] = useState(
    snapshot.settings.autoFulfillEnabled
  );
  const [emailSubjectTemplate, setEmailSubjectTemplate] = useState(
    snapshot.settings.emailSubjectTemplate
  );
  const [emailBodyTemplate, setEmailBodyTemplate] = useState(snapshot.settings.emailBodyTemplate);
  const [whatsappTemplate, setWhatsappTemplate] = useState(snapshot.settings.whatsappTemplate);

  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const previewNewQris = newStaticQris.trim() ? parseQrisMetadata(newStaticQris.trim()) : null;
  const activePreset = getProviderPreset(activeChannel.provider);
  const unifiedWebhookUrl = `${window.location.origin}/api/v1/webhooks/mutation`;

  const macroDroidJson = JSON.stringify(
    {
      title: '{not_title}',
      message: '{not_text}',
      packageName: activeChannel.packageName,
    },
    null,
    2
  );

  const curlSnippet = `curl -X POST "${unifiedWebhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-Webhook-Secret: <WEBHOOK_SECRET_ANDA>" \\
  -d '{"title":"${activeChannel.providerName}","message":"${activePreset.sampleNotification}","packageName":"${activeChannel.packageName}"}'`;

  async function handleCopy(key: string, text: string) {
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  function handleProviderChange(provider: QrisProvider) {
    setNewProvider(provider);
    setNewPackageName(getProviderPreset(provider).defaultPackageName);
  }

  function handleNewQrisInput(value: string) {
    setNewStaticQris(value);
    const trimmed = value.trim();
    if (trimmed.length > 40) {
      const meta = parseQrisMetadata(trimmed);
      if (meta.valid) {
        const detected = detectProviderFromQris(trimmed);
        if (detected !== 'OTHER') {
          setNewProvider(detected);
          setNewPackageName(getProviderPreset(detected).defaultPackageName);
        }
        if (!newLabel.trim() && meta.merchantName && meta.merchantName !== 'Merchant QRIS') {
          const pName = getProviderPreset(detected !== 'OTHER' ? detected : newProvider).name;
          setNewLabel(`${pName} — ${meta.merchantName}`);
        }
      }
    }
  }

  async function handleAddChannel(e: FormEvent) {
    e.preventDefault();
    setChannelFeedback(null);

    if (!newLabel.trim() || newLabel.trim().length < 2) {
      setChannelFeedback({ type: 'error', text: 'Nama channel QRIS wajib diisi (minimal 2 karakter).' });
      return;
    }
    if (!newStaticQris.trim()) {
      setChannelFeedback({ type: 'error', text: 'Tempel string payload QRIS statis terlebih dahulu.' });
      return;
    }

    setAddingChannel(true);
    try {
      const res = await fetch('/api/qris-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: newLabel.trim(),
          provider: newProvider,
          packageName: newPackageName.trim(),
          staticQris: newStaticQris.trim(),
          setActive: setAsActiveOnSave,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChannelFeedback({ type: 'error', text: data.error || 'Gagal menyimpan channel QRIS.' });
        return;
      }

      setNewLabel('');
      setNewStaticQris('');
      setShowAddForm(false);
      setChannelFeedback({
        type: 'success',
        text: `Channel "${data.channel.label}" berhasil disimpan dan dikunci permanen.`,
      });
      await onRefresh();
    } catch {
      setChannelFeedback({ type: 'error', text: 'Gagal terhubung ke server.' });
    } finally {
      setAddingChannel(false);
    }
  }

  async function handleActivateChannel(channel: QrisChannel) {
    setActivatingId(channel.id);
    setChannelFeedback(null);
    try {
      const res = await fetch(`/api/qris-channels/${channel.id}/activate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setChannelFeedback({ type: 'error', text: data.error || 'Gagal mengaktifkan channel.' });
        return;
      }
      setChannelFeedback({
        type: 'success',
        text: `Channel aktif diganti ke "${channel.label}" (${channel.providerName}). Semua checkout baru otomatis memakai QRIS ini.`,
      });
      await onRefresh();
    } finally {
      setActivatingId(null);
    }
  }

  async function handleDeleteChannel(channel: QrisChannel) {
    setDeletingId(channel.id);
    setChannelFeedback(null);
    try {
      const res = await fetch(`/api/qris-channels/${channel.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setChannelFeedback({ type: 'error', text: data.error || 'Gagal menghapus channel.' });
        return;
      }
      setChannelFeedback({
        type: 'success',
        text: `Channel "${channel.label}" telah dihapus.`,
      });
      await onRefresh();
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSaveSettings(e: FormEvent) {
    e.preventDefault();
    setSaveMessage(null);
    setSaving(true);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiryMinutes: Number.parseInt(expiryMinutes, 10) || 30,
          autoFulfillEnabled,
          emailSubjectTemplate,
          emailBodyTemplate,
          whatsappTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveMessage({ type: 'error', text: data.error || 'Gagal menyimpan pengaturan.' });
        return;
      }
      setSaveMessage({
        type: 'success',
        text: 'Pengaturan masa berlaku tagihan & template pengiriman berhasil disimpan.',
      });
      await onRefresh();
    } catch {
      setSaveMessage({ type: 'error', text: 'Gagal terhubung ke server.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Row 1: Multi-QRIS Channel Manager (Permanently Locked Payloads) */}
      <section className="bg-white border border-[#ECEEE6] rounded-[28px] p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#F2F3EE]">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display text-base font-bold text-[#171A1C]">
                Multi-QRIS Payment Gateway ({snapshot.qrisChannels.length} Channel)
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-[#F1FBE0] text-[#3C6E14] text-[11px] font-semibold inline-flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Payload Terkunci Permanen
              </span>
            </div>
            <p className="text-xs text-[#6B727B] mt-1">
              Simpan beberapa QRIS (DANA Bisnis, Neobank BNC, GoPay Merchant, QRIS Bank) dan pilih 1 klik mana yang aktif. Setelah disimpan, kode payload QRIS dikunci permanen dan tidak bisa diedit demi keamanan.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowAddForm((prev) => !prev);
              setChannelFeedback(null);
            }}
            className="px-5 py-2.5 text-xs font-semibold text-[#171A1C] bg-pastel-cta rounded-full inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 shadow-2xs"
          >
            {showAddForm ? (
              <>
                <X className="w-4 h-4" />
                Tutup Form
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Tambah QRIS Baru
              </>
            )}
          </button>
        </div>

        {channelFeedback && (
          <div
            role="status"
            className={`px-4 py-3 rounded-2xl text-xs font-semibold ${
              channelFeedback.type === 'success'
                ? 'bg-[#F1FBE0] text-[#255414] border border-[#D4EF65]'
                : 'bg-[#FFF0ED] text-[#B92D1F] border border-[#FFCBC0]'
            }`}
          >
            {channelFeedback.text}
          </div>
        )}

        {/* Inline Add New QRIS Panel */}
        {showAddForm && (
          <form
            onSubmit={handleAddChannel}
            className="p-5 rounded-[24px] bg-[#FAFBF8] border border-[#D4EF65] space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-bold text-[#171A1C]">
                  Daftarkan Channel QRIS Baru (Neobank, DANA Bisnis, GoPay, dll.)
                </h3>
                <p className="text-xs text-[#6B727B] mt-0.5">
                  Tempel payload string EMVCo QRIS Anda di bawah. Sistem memvalidasi CRC-16 otomatis dan mengunci string permanen setelah disimpan.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <div>
                <label
                  htmlFor="new-qris-provider"
                  className="block text-xs font-semibold text-[#3C424A] mb-1.5"
                >
                  Penyedia QRIS
                </label>
                <select
                  id="new-qris-provider"
                  value={newProvider}
                  onChange={(e) => handleProviderChange(e.target.value as QrisProvider)}
                  className="w-full px-4 py-2.5 text-xs bg-white border border-[#ECEEE6] focus:border-[#CBE855] rounded-2xl text-[#171A1C] focus:outline-none"
                >
                  {QRIS_PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="new-qris-label"
                  className="block text-xs font-semibold text-[#3C424A] mb-1.5"
                >
                  Nama / Label Channel
                </label>
                <input
                  id="new-qris-label"
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Contoh: Neobank Bisnis Utama"
                  className="w-full px-4 py-2.5 text-xs bg-white border border-[#ECEEE6] focus:border-[#CBE855] rounded-2xl text-[#171A1C] focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="new-qris-package"
                  className="block text-xs font-semibold text-[#3C424A] mb-1.5"
                >
                  Android Package Name (MacroDroid)
                </label>
                <input
                  id="new-qris-package"
                  type="text"
                  value={newPackageName}
                  onChange={(e) => setNewPackageName(e.target.value)}
                  placeholder="com.bnc.finance"
                  className="w-full px-4 py-2.5 text-xs font-mono bg-white border border-[#ECEEE6] focus:border-[#CBE855] rounded-2xl text-[#171A1C] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="new-qris-payload"
                className="block text-xs font-semibold text-[#3C424A] mb-1.5"
              >
                Payload String QRIS Statis (akan dikunci permanen setelah disimpan)
              </label>
              <textarea
                id="new-qris-payload"
                rows={4}
                value={newStaticQris}
                onChange={(e) => handleNewQrisInput(e.target.value)}
                placeholder="Tempel string QRIS EMVCo diawali 000201... (hasil scan QRIS Neobank / DANA Bisnis / Bank Anda)"
                className="w-full px-4 py-3 text-xs font-mono bg-white border border-[#ECEEE6] focus:border-[#CBE855] rounded-2xl text-[#171A1C] leading-relaxed focus:outline-none"
              />
            </div>

            {previewNewQris && (
              <div
                className={`p-4 rounded-2xl text-xs grid grid-cols-2 sm:grid-cols-4 gap-3 ${
                  previewNewQris.valid
                    ? 'bg-[#F1FBE0] text-[#1E2B0D]'
                    : 'bg-[#FFF0ED] text-[#9E2416]'
                }`}
              >
                <div>
                  <p className="text-[11px] opacity-75">Validasi CRC-16</p>
                  <p className="font-mono font-bold mt-0.5">
                    {previewNewQris.valid
                      ? `Valid (${previewNewQris.crcProvided})`
                      : `Gagal (${previewNewQris.crcProvided || '-'} ≠ ${previewNewQris.crcExpected || '-'})`}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] opacity-75">Merchant (Tag 59)</p>
                  <p className="font-bold mt-0.5 truncate">{previewNewQris.merchantName}</p>
                </div>
                <div>
                  <p className="text-[11px] opacity-75">NMID (Tag 51.02)</p>
                  <p className="font-mono font-semibold mt-0.5 truncate">{previewNewQris.nmid}</p>
                </div>
                <div>
                  <p className="text-[11px] opacity-75">Acquirer</p>
                  <p className="font-mono mt-0.5 truncate">{previewNewQris.acquirerDomain}</p>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#171A1C] cursor-pointer">
                <input
                  type="checkbox"
                  checked={setAsActiveOnSave}
                  onChange={(e) => setSetAsActiveOnSave(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#171A1C]"
                />
                Langsung jadikan QRIS aktif setelah disimpan
              </label>

              <button
                type="submit"
                disabled={addingChannel || !previewNewQris?.valid}
                className="px-5 py-2.5 rounded-full bg-[#171A1C] hover:bg-[#2B3035] disabled:opacity-45 text-xs font-semibold text-[#D8F36A] inline-flex items-center justify-center gap-1.5 transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
                {addingChannel ? 'Mengunci & Menyimpan...' : 'Kunci & Simpan QRIS'}
              </button>
            </div>
          </form>
        )}

        {/* Saved Locked QRIS Channel Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {snapshot.qrisChannels.map((channel) => {
            const isActive = channel.id === activeChannel.id;
            const isRevealed = Boolean(revealedPayloads[channel.id]);
            return (
              <article
                key={channel.id}
                className={`rounded-[24px] p-5 border transition-all space-y-4 ${
                  isActive
                    ? 'bg-[#F9FEEA] border-[#CBE855]'
                    : 'bg-[#FAFBF8] border-[#ECEEE6]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-0.5 rounded-full bg-white text-[11px] font-bold text-[#171A1C] border border-[#ECEEE6]">
                        {channel.providerName}
                      </span>
                      {isActive && (
                        <span className="px-2.5 py-0.5 rounded-full bg-[#171A1C] text-[#D8F36A] text-[11px] font-semibold inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Aktif Digunakan
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 rounded-full bg-white/80 text-[#5E656E] text-[11px] font-medium inline-flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Terkunci
                      </span>
                    </div>
                    <h3 className="font-display text-sm font-bold text-[#171A1C] mt-2">
                      {channel.label}
                    </h3>
                    <p className="text-xs text-[#5E656E] mt-0.5">
                      {channel.merchantName} · {channel.merchantCity}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isActive && (
                      <button
                        type="button"
                        disabled={activatingId === channel.id}
                        onClick={() => handleActivateChannel(channel)}
                        className="px-3.5 py-1.5 rounded-full bg-pastel-cta text-xs font-semibold text-[#171A1C] whitespace-nowrap disabled:opacity-50"
                      >
                        {activatingId === channel.id ? 'Mengaktifkan...' : 'Jadikan Aktif'}
                      </button>
                    )}
                    {snapshot.qrisChannels.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Hapus channel ${channel.label}`}
                        disabled={deletingId === channel.id}
                        onClick={() => handleDeleteChannel(channel)}
                        className="w-8 h-8 rounded-full bg-white hover:bg-[#FFE4DE] text-[#8A929C] hover:text-[#C83E2B] flex items-center justify-center transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Permanently Locked Read-Only Payload Code Block (NOT editable) */}
                <div className="rounded-2xl bg-white border border-[#ECEEE6] p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-semibold text-[#4B525A] inline-flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#3C6E14]" />
                      Payload String QRIS (Read-Only · Tidak Bisa Diedit)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setRevealedPayloads((prev) => ({
                            ...prev,
                            [channel.id]: !prev[channel.id],
                          }))
                        }
                        className="text-[#5E656E] hover:text-[#171A1C] inline-flex items-center gap-1 font-medium"
                      >
                        {isRevealed ? (
                          <>
                            <EyeOff className="w-3 h-3" />
                            Ringkas
                          </>
                        ) : (
                          <>
                            <Eye className="w-3 h-3" />
                            Lihat Penuh
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopy(`qris-${channel.id}`, channel.staticQris)}
                        className="text-[#7E2FA0] hover:underline font-semibold inline-flex items-center gap-1"
                      >
                        {copiedKey === `qris-${channel.id}` ? (
                          <>
                            <Check className="w-3 h-3" />
                            Disalin
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Salin
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <div
                    data-testid={`locked-qris-payload-${channel.id}`}
                    className="font-mono text-[11px] text-[#3C424A] bg-[#F6F7F4] rounded-xl px-3 py-2 break-all select-all leading-relaxed"
                  >
                    {isRevealed ? channel.staticQris : maskQrisPayload(channel.staticQris)}
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <div>
                    <dt className="text-[#6B727B]">NMID</dt>
                    <dd className="font-mono font-semibold text-[#171A1C] tabular-nums truncate">
                      {channel.nmid}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B727B]">CRC-16 / Acquirer</dt>
                    <dd className="font-mono text-[#3C6E14] font-semibold truncate">
                      {channel.crc16} · {channel.acquirerDomain}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#6B727B]">Channel ID (API v1)</dt>
                    <dd className="font-mono text-[#4B525A] truncate">{channel.id}</dd>
                  </div>
                  <div>
                    <dt className="text-[#6B727B]">Package Android</dt>
                    <dd className="font-mono text-[#4B525A] truncate">{channel.packageName}</dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      </section>

      {/* Row 2: Unified Multi-QRIS Android Webhook Guide + Server Readiness */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <section className="lg:col-span-7 bg-white border border-[#ECEEE6] rounded-[28px] p-6 space-y-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#171A1C]">
              Webhook Otomatis Notifikasi Android ({activeChannel.providerName})
            </h2>
            <p className="text-xs text-[#6B727B] mt-0.5">
              Satu endpoint webhook dapat menerima notifikasi dari DANA Bisnis (<code className="font-mono">id.dana.merchant</code>), Neobank BNC (<code className="font-mono">com.bnc.finance</code>), GoPay Merchant, maupun QRIS Bank secara bersamaan.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-[#3C424A] mb-1.5">
              Endpoint Webhook Multi-QRIS (HTTP POST)
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-4 py-2.5 text-xs font-mono bg-[#F6F7F4] rounded-2xl text-[#171A1C] truncate">
                {unifiedWebhookUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopy('webhookUrl', unifiedWebhookUrl)}
                className="px-4 py-2.5 text-xs font-semibold text-[#171A1C] bg-pastel-cta rounded-full inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copiedKey === 'webhookUrl' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    Disalin
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

          <ol className="text-xs text-[#4B525A] space-y-1.5 list-decimal pl-4">
            <li>
              Di aplikasi <strong>MacroDroid</strong>, buat Trigger: <em>Notification Received</em> dan centang aplikasi <strong>{activeChannel.providerName}</strong> (<code className="font-mono">{activeChannel.packageName}</code>) — Anda bisa mencentang DANA Bisnis & Neobank sekaligus.
            </li>
            <li>
              Tambahkan Action: <em>HTTP Request (POST)</em> ke URL endpoint di atas dengan header <code className="font-mono">Content-Type: application/json</code> dan <code className="font-mono">X-Webhook-Secret</code>.
            </li>
            <li>Isi Body JSON MacroDroid dengan format berikut:</li>
          </ol>

          <div className="relative">
            <pre className="p-4 bg-[#171A1C] text-[#F1F5EE] rounded-2xl text-xs font-mono overflow-x-auto leading-relaxed">
              {macroDroidJson}
            </pre>
            <button
              type="button"
              onClick={() => handleCopy('macroJson', macroDroidJson)}
              className="absolute top-3 right-3 px-3 py-1 text-[11px] font-semibold bg-[#D8F36A] hover:bg-[#CBE855] text-[#171A1C] rounded-full"
            >
              {copiedKey === 'macroJson' ? 'Disalin' : 'Salin JSON'}
            </button>
          </div>

          <div className="pt-2 border-t border-[#F2F3EE] space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-[#3C424A]">
                Contoh Pengujian cURL ({activeChannel.providerName})
              </p>
              <button
                type="button"
                onClick={() => handleCopy('curl', curlSnippet)}
                className="text-xs font-semibold text-[#7E2FA0] hover:underline"
              >
                {copiedKey === 'curl' ? 'Disalin' : 'Salin cURL'}
              </button>
            </div>
            <pre className="p-3.5 bg-[#F6F7F4] rounded-2xl text-[11px] font-mono text-[#4B525A] overflow-x-auto leading-relaxed">
              {curlSnippet}
            </pre>
          </div>
        </section>

        <section className="lg:col-span-5 bg-pastel-lavender rounded-[28px] p-6 flex flex-col justify-between space-y-4">
          <div>
            <h2 className="font-display text-base font-bold text-[#171A1C]">
              Kesiapan Koneksi Server Gateway
            </h2>
            <p className="text-xs text-[#432E4C]/85 mt-1 leading-relaxed">
              Kredensial API disimpan aman di variabel lingkungan server (<code className="font-mono">.env</code> / panel Secrets) dan tidak pernah diekspos di browser.
            </p>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-4 rounded-[20px] bg-white/85">
              <p className="text-[#6B727B]">Keamanan Webhook Masuk</p>
              <p className="mt-1 font-bold text-[#171A1C]">
                {snapshot.integration.webhookSecretConfigured
                  ? 'Aktif (Header X-Webhook-Secret)'
                  : 'Mode Terbuka (Set WEBHOOK_SECRET)'}
              </p>
              <p className="mt-0.5 text-[#6B727B] font-mono">WEBHOOK_SECRET</p>
            </div>

            <div className="p-4 rounded-[20px] bg-white/85">
              <p className="text-[#6B727B]">Pengiriman Email Real-Time</p>
              <p className="mt-1 font-bold text-[#171A1C]">
                {snapshot.integration.emailConfigured
                  ? `Terhubung (${snapshot.integration.emailProvider.toUpperCase()})`
                  : 'Mode Pratinjau (Set RESEND_API_KEY / SMTP)'}
              </p>
              <p className="mt-0.5 text-[#6B727B] font-mono">RESEND_API_KEY · SMTP_HOST</p>
            </div>

            <div className="p-4 rounded-[20px] bg-white/85">
              <p className="text-[#6B727B]">Gateway WhatsApp Real-Time</p>
              <p className="mt-1 font-bold text-[#171A1C]">
                {snapshot.integration.whatsappConfigured
                  ? `Terhubung (${snapshot.integration.whatsappProvider.toUpperCase()})`
                  : 'Mode Pratinjau (Set WA_GATEWAY_URL)'}
              </p>
              <p className="mt-0.5 text-[#6B727B] font-mono">WA_GATEWAY_URL · WA_API_TOKEN</p>
            </div>
          </div>
        </section>
      </div>

      {/* Row 3: Editable Fulfillment Templates & Rules */}
      <section className="bg-white border border-[#ECEEE6] rounded-[28px] p-6">
        <div className="pb-4 border-b border-[#F2F3EE]">
          <h2 className="font-display text-base font-bold text-[#171A1C]">
            Template Pesan Pengiriman Akses Otomatis
          </h2>
          <p className="text-xs text-[#6B727B] mt-1">
            Variabel tersedia:{' '}
            <code className="font-mono text-[#3C424A]">
              {'{{nama_pembeli}} {{nama_produk}} {{nominal}} {{kode_pesanan}} {{link_akses}} {{kunci_lisensi}} {{merchant}}'}
            </code>
          </p>
        </div>

        <form onSubmit={handleSaveSettings} className="mt-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div>
              <label
                htmlFor="expiry-minutes"
                className="block text-xs font-semibold text-[#3C424A] mb-1.5"
              >
                Masa Berlaku Tagihan QRIS (Menit)
              </label>
              <input
                id="expiry-minutes"
                type="number"
                min={5}
                max={180}
                value={expiryMinutes}
                onChange={(e) => setExpiryMinutes(e.target.value)}
                className="w-40 px-4 py-2.5 text-sm font-mono tabular-nums bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              />
            </div>

            <div className="flex items-center gap-2.5 pt-4 md:pt-5">
              <input
                id="auto-fulfill-toggle"
                type="checkbox"
                checked={autoFulfillEnabled}
                onChange={(e) => setAutoFulfillEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-[#D0D5C8] accent-[#171A1C]"
              />
              <label htmlFor="auto-fulfill-toggle" className="text-xs font-semibold text-[#171A1C]">
                Kirim akses produk via Email & WhatsApp secara otomatis saat mutasi cocok
              </label>
            </div>
          </div>

          <div>
            <label
              htmlFor="email-subject-tpl"
              className="block text-xs font-semibold text-[#3C424A] mb-1.5"
            >
              Subjek Email Pembeli
            </label>
            <input
              id="email-subject-tpl"
              type="text"
              value={emailSubjectTemplate}
              onChange={(e) => setEmailSubjectTemplate(e.target.value)}
              className="w-full px-4 py-2.5 text-sm bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div>
              <label
                htmlFor="email-body-tpl"
                className="block text-xs font-semibold text-[#3C424A] mb-1.5"
              >
                Isi Pesan Email
              </label>
              <textarea
                id="email-body-tpl"
                rows={9}
                value={emailBodyTemplate}
                onChange={(e) => setEmailBodyTemplate(e.target.value)}
                className="w-full px-4 py-3 text-xs font-mono bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] leading-relaxed focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label
                htmlFor="wa-body-tpl"
                className="block text-xs font-semibold text-[#3C424A] mb-1.5"
              >
                Isi Pesan WhatsApp
              </label>
              <textarea
                id="wa-body-tpl"
                rows={9}
                value={whatsappTemplate}
                onChange={(e) => setWhatsappTemplate(e.target.value)}
                className="w-full px-4 py-3 text-xs font-mono bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] leading-relaxed focus:outline-none transition-colors"
              />
            </div>
          </div>

          {saveMessage && (
            <p
              role="status"
              className={`text-xs font-semibold ${
                saveMessage.type === 'success' ? 'text-[#3C6E14]' : 'text-[#C83E2B]'
              }`}
            >
              {saveMessage.text}
            </p>
          )}

          <div className="flex justify-end pt-3 border-t border-[#F2F3EE]">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 text-xs font-semibold text-[#171A1C] bg-pastel-cta disabled:opacity-50 rounded-full transition-all inline-flex items-center gap-1.5 shadow-2xs"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Menyimpan...' : 'Simpan Template & Aturan'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
