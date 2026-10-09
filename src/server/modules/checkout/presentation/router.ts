import {
  createTRPCRouter,
  getClientIp,
  publicProcedure,
  rateLimit,
} from "elestampadero/server/api/trpc";
import { createOrderUseCase } from "elestampadero/server/modules/orders";
import { getVariantsForPricingUseCase } from "elestampadero/server/modules/catalog";
import { resolveRateForProductUseCase } from "elestampadero/server/modules/agreements";

import { checkCartAvailability } from "../application/use-cases/check-cart-availability";
import { submitCheckout } from "../application/use-cases/submit-checkout";
import {
  cartAvailabilityInputSchema,
  submitCheckoutInputSchema,
} from "./schemas";

const checkCartAvailabilityUseCase = checkCartAvailability({
  getVariantsForPricing: getVariantsForPricingUseCase,
});
const submitCheckoutUseCase = submitCheckout({
  getVariantsForPricing: getVariantsForPricingUseCase,
  createOrder: createOrderUseCase,
  resolveClubRate: resolveRateForProductUseCase,
});

export const checkoutRouter = createTRPCRouter({
  availability: publicProcedure
    .input(cartAvailabilityInputSchema)
    .query(({ input }) => checkCartAvailabilityUseCase(input.lines)),

  submit: publicProcedure
    .input(submitCheckoutInputSchema)
    .use(
      rateLimit({
        limit: 10,
        windowMs: 10 * 60_000,
        key: ({ ctx }) => `checkout:${getClientIp(ctx.headers)}`,
      }),
    )
    .mutation(({ ctx, input }) =>
      submitCheckoutUseCase({
        checkoutRequestId: input.checkoutRequestId,
        userId: ctx.session?.user.id ?? null,
        contactName: input.contactName,
        customerDocument: input.customerDocument ?? null,
        invoiceA: input.requiresInvoiceA
          ? {
              taxId: input.customerTaxId!,
              legalName: input.customerLegalName!,
              taxCondition: input.customerTaxCondition!,
            }
          : null,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        deliveryMethod: input.deliveryMethod,
        shippingAddress: input.shippingAddress ?? null,
        shippingCity: input.shippingCity ?? null,
        shippingPostalCode: input.shippingPostalCode ?? null,
        lines: input.lines,
      }),
    ),
});
