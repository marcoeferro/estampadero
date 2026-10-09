import "server-only";

import { env } from "elestampadero/env";

import { createInvoicingService } from "./application/invoicing-service";
import type { InvoicingProvider } from "./application/ports/invoicing-provider";
import { sendInvoiceEmail } from "./infrastructure/invoice-email";
import { prismaInvoicingRepository } from "./infrastructure/persistence/prisma-invoicing-repository";
import { createFacturanteProvider } from "./infrastructure/providers/facturante-provider";
import { createSimulatedInvoicingProvider } from "./infrastructure/providers/simulated-provider";

function buildProvider(): InvoicingProvider | null {
  if (env.INVOICING_PROVIDER === "simulated") {
    return createSimulatedInvoicingProvider();
  }
  if (env.INVOICING_PROVIDER === "facturante") {
    if (
      !env.FACTURANTE_USER ||
      !env.FACTURANTE_PASSWORD ||
      !env.FACTURANTE_COMPANY_ID
    ) {
      console.error(
        "[invoicing] INVOICING_PROVIDER=facturante sin FACTURANTE_USER, FACTURANTE_PASSWORD o FACTURANTE_COMPANY_ID; no se emiten comprobantes.",
      );
      return null;
    }
    return createFacturanteProvider({
      environment: env.FACTURANTE_ENVIRONMENT,
      user: env.FACTURANTE_USER,
      password: env.FACTURANTE_PASSWORD,
      companyId: env.FACTURANTE_COMPANY_ID,
    });
  }
  return null;
}

export const invoicingService = createInvoicingService({
  repository: prismaInvoicingRepository,
  provider: buildProvider(),
  config: {
    issuerTaxCondition: env.INVOICING_ISSUER_TAX_CONDITION,
    clubItemsMode: env.INVOICING_CLUB_ITEMS_MODE,
    vatRate: env.INVOICING_VAT_RATE,
    pointOfSale: env.INVOICING_POINT_OF_SALE ?? null,
  },
  onInvoiceIssued: sendInvoiceEmail,
});
