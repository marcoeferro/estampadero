import "server-only";

import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";

import type { PaymentGateway } from "../ports/payment-gateway";
import type {
  PaymentProviderValue,
  PaymentsRepository,
} from "../ports/payments-repository";

export interface RefundPaymentCommand {
  paymentId: string;

  amountInCents?: number;
}

export interface RefundPaymentOutcome {
  status: "REFUNDED" | "PARTIALLY_REFUNDED";
  providerRefundId: string;
  amountRefundedInCents: number;
}

interface RefundPaymentDeps {
  gateway: PaymentGateway;
  repository: PaymentsRepository;

  provider: PaymentProviderValue;
}

const REFUNDABLE_STATUSES = new Set(["APPROVED", "PARTIALLY_REFUNDED"]);

export function refundPayment(deps: RefundPaymentDeps) {
  return async (
    command: RefundPaymentCommand,
  ): Promise<RefundPaymentOutcome> => {
    const payment = await deps.repository.findById(command.paymentId);
    if (!payment) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Pago no encontrado.",
      });
    }
    if (payment.provider !== deps.provider) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Este pago no se procesó con ${deps.provider}; no se puede reintegrar desde acá.`,
      });
    }
    if (!payment.providerPaymentId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Este pago todavía no tiene un identificador del proveedor.",
      });
    }
    if (!REFUNDABLE_STATUSES.has(payment.status)) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Solo se puede reintegrar dinero de pagos aprobados.",
      });
    }
    if (!deps.gateway.refundPayment) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Este medio de pago no admite reintegros desde el sistema.",
      });
    }

    const alreadyRefundedInCents = payment.amountRefundedInCents ?? 0;
    const remainingInCents = payment.amountInCents - alreadyRefundedInCents;
    const amountInCents = command.amountInCents ?? remainingInCents;
    if (amountInCents <= 0 || amountInCents > remainingInCents) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "El importe a reintegrar no es válido para este pago.",
      });
    }

    let result;
    try {
      result = await deps.gateway.refundPayment({
        providerPaymentId: payment.providerPaymentId,
        amountInCents,
        idempotencyKey: randomUUID(),
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "El medio de pago rechazó la devolución.";

      throw new TRPCError({ code: "CONFLICT", message });
    }

    const newAmountRefundedInCents = Math.min(
      payment.amountInCents,
      alreadyRefundedInCents + result.amountInCents,
    );
    const status =
      newAmountRefundedInCents >= payment.amountInCents
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";

    await deps.repository.recordRefund?.({
      paymentId: payment.id,
      amountRefundedInCents: newAmountRefundedInCents,
      status,
      providerRefundId: result.providerRefundId,
      lastRefundAmountInCents: result.amountInCents,
    });

    return {
      status,
      providerRefundId: result.providerRefundId,
      amountRefundedInCents: newAmountRefundedInCents,
    };
  };
}
