import type { OrderDetailDto } from "../dto/order-detail";
import type { OrderMetricsDto, OrderSummaryDto } from "../dto/order-summary";

export interface CreateOrderItemInput {
  productId: string;
  productName: string;
  productSlug: string;
  variantId: string;
  size: string;
  color: string;
  imageUrl: string | null;
  priceInCentsSnapshot: number;
  quantity: number;
  lineTotalInCents: number;
  stockControlled: boolean;
  clubId: string | null;
  clubNameSnapshot: string | null;
  clubAgreementId?: string | null;
  clubSharePercentage?: number | null;
}

export interface CreateOrderInput {
  checkoutRequestId: string;
  userId: string | null;
  contactName: string;
  customerDocument?: string | null;
  customerTaxId?: string | null;
  customerLegalName?: string | null;
  customerTaxCondition?:
    | "CONSUMIDOR_FINAL"
    | "RESPONSABLE_INSCRIPTO"
    | "MONOTRIBUTO"
    | "EXENTO"
    | null;
  contactEmail: string;
  contactPhone: string;
  deliveryMethod: "SHIPPING" | "PICKUP";
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingPostalCode: string | null;
  subtotalInCents: number;
  shippingInCents: number;
  totalInCents: number;
  items: CreateOrderItemInput[];
}

export interface CreateExternalOrderInput {
  contactName: string;
  customerDocument?: string | null;
  contactEmail: string;
  contactPhone: string;
  deliveryMethod: "SHIPPING" | "PICKUP";
  shippingAddress: string | null;
  shippingCity: string | null;
  shippingPostalCode: string | null;
  items: { variantId: string; quantity: number }[];
}

export type OrderStatusValue =
  | "PENDING_PAYMENT"
  | "PAID"
  | "IN_PRODUCTION"
  | "READY_FOR_SHIPPING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";

export interface OrdersRepository {
  createOrder(input: CreateOrderInput): Promise<OrderDetailDto>;
  createExternalOrder(input: CreateExternalOrderInput): Promise<OrderDetailDto>;
  expireUnpaidOrders(input: {
    createdBefore: Date;
    paymentActivityBefore: Date;
    limit: number;
  }): Promise<number>;
  getOrderById(id: string): Promise<OrderDetailDto | null>;
  listOrders(filters: {
    status?: OrderStatusValue;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    paymentCategory?: "ACTIVE" | "REJECTED";
  }): Promise<OrderSummaryDto[]>;
  updateOrderStatus(
    id: string,
    status: OrderStatusValue,
    note: string | null,
  ): Promise<OrderDetailDto>;
  getMetrics(
    period: "day" | "week" | "month" | "year",
  ): Promise<OrderMetricsDto>;
}
