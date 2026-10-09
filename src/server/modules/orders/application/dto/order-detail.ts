export interface OrderItemDto {
  id: string;
  productId: string;
  productName: string;
  productSlug: string;
  size: string;
  color: string;
  imageUrl: string | null;
  priceInCentsSnapshot: number;
  quantity: number;
  lineTotalInCents: number;
  clubId: string | null;
  clubNameSnapshot: string | null;
  clubAgreementId: string | null;
  clubSharePercentage: number | null;
}

export interface OrderDetailDto {
  id: string;
  orderNumber: number;
  status: string;
  contactName: string;
  customerDocument?: string | null;
  contactEmail: string;
  contactPhone: string;
  deliveryMethod: string;
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingPostalCode: string | null;
  subtotalInCents: number;
  shippingInCents: number;
  totalInCents: number;
  createdAt: string;
  receiptEmailSentAt?: string | null;
  payment?: {
    id: string;
    status: string;
    channel: string;
    provider: string;
    amountInCents: number;
    paymentMethodType: string | null;
    paymentMethodId: string | null;
    installments: number | null;
    moneyReleaseDate: string | null;
    moneyReleasedAt: string | null;
    netReceivedInCents: number | null;
    feeInCents: number | null;
    financingFeeInCents: number | null;
    amountRefundedInCents: number;
    lastProviderRefundId: string | null;
  } | null;
  deliveredAt?: string | null;
  items: OrderItemDto[];
}
