import { useState, type FormEvent } from 'react';
import { Check, Copy, ExternalLink, Pencil, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import type { DashboardSnapshot, DigitalProduct } from '../types';
import { formatRupiah } from '../lib/qris';
import { copyTextToClipboard } from '../lib/format';

interface ProductsViewProps {
  snapshot: DashboardSnapshot;
  onRefresh: () => Promise<void>;
  onOpenCheckout: (productId: string) => void;
  showCreateTrigger?: number;
}

interface ProductFormState {
  name: string;
  category: string;
  price: string;
  accessUrl: string;
  licensePrefix: string;
  fileInfo: string;
  description: string;
}

const EMPTY_FORM: ProductFormState = {
  name: '',
  category: 'E-Book & Panduan',
  price: '',
  accessUrl: '',
  licensePrefix: 'DIGI',
  fileInfo: '',
  description: '',
};

const CARD_TOP_ACCENTS = [
  'bg-pastel-lime',
  'bg-pastel-lavender',
  'bg-[#D8EEFC]',
];

export function ProductsView({
  snapshot,
  onRefresh,
  onOpenCheckout,
  showCreateTrigger,
}: ProductsViewProps) {
  const [formOpen, setFormOpen] = useState(Boolean(showCreateTrigger));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function openNewForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(product: DigitalProduct) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      category: product.category,
      price: String(product.price),
      accessUrl: product.accessUrl,
      licensePrefix: product.licensePrefix,
      fileInfo: product.fileInfo,
      description: product.description,
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsedPrice = Number.parseInt(form.price.replace(/\D/g, ''), 10);
    if (!form.name.trim() || form.name.trim().length < 3) {
      setFormError('Nama produk digital minimal 3 karakter.');
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 1000) {
      setFormError('Harga produk minimal Rp 1.000.');
      return;
    }
    if (!/^https?:\/\//i.test(form.accessUrl.trim())) {
      setFormError('Link akses produk harus diawali https:// atau http://.');
      return;
    }

    setSaving(true);
    try {
      const endpoint = editingId ? `/api/products/${editingId}` : '/api/products';
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category.trim() || 'Produk Digital',
          price: parsedPrice,
          accessUrl: form.accessUrl.trim(),
          licensePrefix: form.licensePrefix.trim().toUpperCase() || 'DIGI',
          fileInfo: form.fileInfo.trim() || 'Akses Instan',
          description: form.description.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Gagal menyimpan produk digital.');
        return;
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await onRefresh();
    } catch {
      setFormError('Gagal terhubung ke server.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(product: DigitalProduct) {
    setDeletingId(product.id);
    try {
      const res = await fetch(`/api/products/${product.id}`, { method: 'DELETE' });
      if (res.ok) {
        await onRefresh();
      }
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCopyShareLink(product: DigitalProduct) {
    const url = `${window.location.origin}/?checkout=${encodeURIComponent(product.id)}`;
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopiedId(product.id);
      setTimeout(() => setCopiedId(null), 1800);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#FAFBF8] border border-[#ECEEE6] rounded-[26px] px-6 py-4">
        <div>
          <h2 className="font-display text-base font-bold text-[#171A1C]">
            Katalog Produk Digital ({snapshot.products.length})
          </h2>
          <p className="text-xs text-[#6B727B] mt-0.5">
            Setiap produk memiliki tautan checkout QRIS dinamis dan pengiriman link akses otomatis ke Email & WhatsApp.
          </p>
        </div>
        {!formOpen && (
          <button
            type="button"
            onClick={openNewForm}
            className="px-5 py-2.5 text-xs font-semibold text-[#171A1C] bg-pastel-cta rounded-full transition-all inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 w-fit shadow-2xs"
          >
            <Plus className="w-4 h-4" />
            Tambah Produk Digital
          </button>
        )}
      </div>

      {/* Add / Edit Product Form */}
      {formOpen && (
        <section className="bg-white border border-[#ECEEE6] rounded-[28px] p-6">
          <div className="flex items-center justify-between pb-4 border-b border-[#F2F3EE]">
            <h3 className="font-display text-sm font-bold text-[#171A1C]">
              {editingId ? 'Ubah Detail Produk Digital' : 'Tambah Produk Digital Baru'}
            </h3>
            <button
              type="button"
              aria-label="Tutup formulir produk"
              onClick={() => setFormOpen(false)}
              className="w-8 h-8 rounded-full bg-[#F5F6F2] text-[#5E656E] hover:text-[#171A1C] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="prod-name" className="block text-xs font-semibold text-[#3C424A] mb-1.5">
                Nama Produk Digital
              </label>
              <input
                id="prod-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Contoh: Template Spreadsheet Keuangan & Pajak UMKM"
                className="w-full px-4 py-2.5 text-sm bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="prod-price" className="block text-xs font-semibold text-[#3C424A] mb-1.5">
                Harga Dasar (Rupiah)
              </label>
              <input
                id="prod-price"
                type="number"
                min={1000}
                step={500}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="79000"
                className="w-full px-4 py-2.5 text-sm font-mono tabular-nums bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="prod-category" className="block text-xs font-semibold text-[#3C424A] mb-1.5">
                Kategori Produk
              </label>
              <select
                id="prod-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-4 py-2.5 text-sm bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              >
                <option value="E-Book & Panduan">E-Book & Panduan</option>
                <option value="Template Spreadsheet">Template Spreadsheet</option>
                <option value="Kelas Video">Kelas Video</option>
                <option value="Source Code & Script">Source Code & Script</option>
                <option value="Akses Komunitas">Akses Komunitas</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="prod-access-url"
                className="block text-xs font-semibold text-[#3C424A] mb-1.5"
              >
                Link Akses / Unduhan Produk (Dikirim Otomatis Setelah Lunas)
              </label>
              <input
                id="prod-access-url"
                type="url"
                value={form.accessUrl}
                onChange={(e) => setForm({ ...form, accessUrl: e.target.value })}
                placeholder="https://drive.google.com/... atau https://member.domainanda.id/akses"
                className="w-full px-4 py-2.5 text-sm bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="prod-file-info" className="block text-xs font-semibold text-[#3C424A] mb-1.5">
                Format / Isi Paket
              </label>
              <input
                id="prod-file-info"
                type="text"
                value={form.fileInfo}
                onChange={(e) => setForm({ ...form, fileInfo: e.target.value })}
                placeholder="Contoh: PDF 120 hal + Bonus Template"
                className="w-full px-4 py-2.5 text-sm bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="prod-prefix" className="block text-xs font-semibold text-[#3C424A] mb-1.5">
                Awalan Kunci Lisensi (Maks 6 huruf)
              </label>
              <input
                id="prod-prefix"
                type="text"
                maxLength={6}
                value={form.licensePrefix}
                onChange={(e) => setForm({ ...form, licensePrefix: e.target.value.toUpperCase() })}
                placeholder="EBK"
                className="w-full px-4 py-2.5 text-sm font-mono uppercase bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="prod-desc" className="block text-xs font-semibold text-[#3C424A] mb-1.5">
                Deskripsi Singkat Produk
              </label>
              <textarea
                id="prod-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Jelaskan manfaat utama produk digital yang akan diterima pembeli..."
                className="w-full px-4 py-2.5 text-sm bg-[#F6F7F4] border border-transparent focus:border-[#CBE855] focus:bg-white rounded-2xl text-[#171A1C] focus:outline-none transition-colors"
              />
            </div>

            {formError && (
              <p role="alert" className="md:col-span-2 text-xs font-semibold text-[#C83E2B]">
                {formError}
              </p>
            )}

            <div className="md:col-span-2 flex items-center justify-end gap-3 pt-3 border-t border-[#F2F3EE]">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="px-5 py-2 text-xs font-semibold text-[#5E656E] bg-[#F5F6F2] hover:bg-[#ECEEE6] rounded-full transition-colors"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 text-xs font-semibold text-[#171A1C] bg-pastel-cta disabled:opacity-50 rounded-full transition-all"
              >
                {saving ? 'Menyimpan...' : editingId ? 'Simpan Perubahan' : 'Simpan Produk'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Product Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {snapshot.products.map((product, idx) => {
          const soldCount = snapshot.orders.filter(
            (o) => o.productId === product.id && o.status === 'PAID'
          ).length;
          const accent = CARD_TOP_ACCENTS[idx % CARD_TOP_ACCENTS.length];

          return (
            <article
              key={product.id}
              className="bg-white border border-[#ECEEE6] rounded-[28px] p-5 flex flex-col justify-between relative overflow-hidden"
            >
              <div>
                <div className={`rounded-[20px] p-4 ${accent}`}>
                  <p className="text-[11px] font-semibold text-[#2B3328]/80">
                    {product.category} <span aria-hidden="true">·</span> {product.fileInfo}
                  </p>
                  <h3 className="mt-1.5 font-display text-base font-bold text-[#171A1C] leading-snug">
                    {product.name}
                  </h3>
                  <p className="mt-3 text-xl font-bold text-[#171A1C] font-mono tabular-nums">
                    {formatRupiah(product.price)}
                  </p>
                </div>

                <p className="mt-4 text-xs text-[#5E656E] leading-relaxed line-clamp-3">
                  {product.description}
                </p>

                <div className="mt-4 pt-3 border-t border-[#F2F3EE] flex items-center justify-between gap-2 text-xs text-[#6B727B]">
                  <span className="tabular-nums">
                    {soldCount} terjual · Prefiks {product.licensePrefix}
                  </span>
                </div>

                <a
                  href={product.accessUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 text-xs text-[#7E2FA0] hover:underline inline-flex items-center gap-1 max-w-full truncate"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="truncate">{product.accessUrl}</span>
                </a>
              </div>

              <div className="mt-5 pt-4 border-t border-[#F2F3EE] flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-label={`Buka checkout ${product.name}`}
                  onClick={() => onOpenCheckout(product.id)}
                  className="px-4 py-2 text-xs font-semibold text-[#D8F36A] bg-[#171A1C] hover:bg-[#2B3035] rounded-full transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <ShoppingBag className="w-3.5 h-3.5" />
                  Buka Checkout
                </button>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Salin link checkout ${product.name}`}
                    onClick={() => handleCopyShareLink(product)}
                    className="w-8 h-8 rounded-full bg-[#F5F6F2] text-[#5E656E] hover:text-[#171A1C] hover:bg-[#E7F4B5] flex items-center justify-center transition-colors"
                    title="Salin link checkout produk"
                  >
                    {copiedId === product.id ? (
                      <Check className="w-3.5 h-3.5 text-[#3C6E14]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit ${product.name}`}
                    onClick={() => openEditForm(product)}
                    className="w-8 h-8 rounded-full bg-[#F5F6F2] text-[#5E656E] hover:text-[#171A1C] hover:bg-[#F5D8FF] flex items-center justify-center transition-colors"
                    title="Edit produk"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus ${product.name}`}
                    disabled={deletingId === product.id}
                    onClick={() => handleDelete(product)}
                    className="w-8 h-8 rounded-full bg-[#F5F6F2] text-[#8A929C] hover:text-[#C83E2B] hover:bg-[#FFE4DE] flex items-center justify-center transition-colors disabled:opacity-50"
                    title="Hapus produk"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
