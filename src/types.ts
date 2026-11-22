export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'SIMULATED_SENT' | 'FAILED';
export type MutationStatus = 'MATCHED' | 'UNMATCHED' | 'IGNORED';

export type QrisProvider =
  | 'DANA_BISNIS'
  | 'NEOBANK'
  | 'GOPAY_MERCHANT'
  | 'SHOPEEPAY_MERCHANT'
  | 'BANK_QRIS'
  | 'OTHER';

export interface QrisChannel {
  id: string;
  label: string;
  provider: QrisProvider;
  providerName: string;
  packageName: string;
  staticQris: string;
  merchantName: string;
  merchantCity: string;
  postalCode: string;
  nmid: string;
  acquirerDomain: string;
  merchantPan: string;
  merchantCriteria: string;
  mcc: string;
  crc16: string;
  locked: true;
  createdAt: string;
}

export interface DigitalProduct {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  price: number;
  accessUrl: string;
  licensePrefix: string;
  fileInfo: string;
  active: boolean;
  createdAt: string;
}

export interface DeliveryChannelLog {
  status: DeliveryStatus;
  recipient: string;
  provider: string;
  subject?: string;
  messagePreview: string;
  sentAt: string | null;
  error?: string;
}

export interface OrderRecord {
  id: string;
  orderCode: string;
  externalId?: string | null;
  callbackUrl?: string | null;
  returnUrl?: string | null;
  fulfillmentMode?: 'BOTH' | 'EXTERNAL_ONLY';
  metadata?: Record<string, unknown> | null;
  qrisChannelId?: string | null;
  qrisChannelLabel?: string | null;
  qrisProvider?: QrisProvider | null;
  productId: string;
  productName: string;
  buyerName: string;
  buyerEmail: string;
  buyerWhatsapp: string;
  baseAmount: number;
  uniqueCode: number;
  totalAmount: number;
  dynamicQris: string;
  status: OrderStatus;
  accessUrl: string;
  licenseKey: string;
  matchedMutationId: string | null;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
  emailDelivery: DeliveryChannelLog;
  whatsappDelivery: DeliveryChannelLog;
}

export interface MutationRecord {
  id: string;
  source: 'DANA_WEBHOOK' | 'MANUAL_SIMULATION';
  packageName: string;
  providerName?: string;
  title: string;
  rawMessage: string;
  amount: number;
  senderName: string;
  referenceId: string;
  status: MutationStatus;
  matchedOrderId: string | null;
  matchedOrderCode: string | null;
  receivedAt: string;
}

export type WebhookEventType =
  | 'payment.created'
  | 'payment.paid'
  | 'payment.expired'
  | 'mutation.received'
  | 'webhook.ping';

export interface OutboundWebhookEndpoint {
  id: string;
  name: string;
  url: string;
  events: WebhookEventType[];
  active: boolean;
  createdAt: string;
}

export interface OutboundWebhookLog {
  id: string;
  deliveryId: string;
  endpointId: string | null;
  endpointName: string;
  url: string;
  event: WebhookEventType;
  status: 'SUCCESS' | 'FAILED';
  httpStatus: number | null;
  durationMs: number;
  payloadJson: string;
  responseSnippet: string;
  signatureHeader: string;
  sentAt: string;
}

export interface MerchantSettings {
  activeQrisChannelId: string;
  staticQris: string;
  expiryMinutes: number;
  emailSubjectTemplate: string;
  emailBodyTemplate: string;
  whatsappTemplate: string;
  autoFulfillEnabled: boolean;
}

export interface IntegrationStatus {
  webhookSecretConfigured: boolean;
  externalApiKeyConfigured: boolean;
  outboundSigningSecretConfigured: boolean;
  emailProvider: 'resend' | 'smtp' | 'preview';
  emailConfigured: boolean;
  whatsappProvider: string;
  whatsappConfigured: boolean;
}

export interface DashboardSnapshot {
  qrisChannels: QrisChannel[];
  products: DigitalProduct[];
  orders: OrderRecord[];
  mutations: MutationRecord[];
  webhooks: OutboundWebhookEndpoint[];
  webhookLogs: OutboundWebhookLog[];
  settings: MerchantSettings;
  integration: IntegrationStatus;
}
