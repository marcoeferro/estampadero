import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({




  server: {
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    AUTH_TRUST_HOST: z.coerce.boolean().default(false),
    AUTH_URL: z.string().url().optional(),
    AUTH_GOOGLE_ID: z.string().min(1).optional(),
    AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
    DATABASE_URL: z.string().url(),
    PRISMA_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).default(10),
    PRISMA_POOL_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(15),
    UNPAID_ORDER_EXPIRATION_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    MOBBEX_API_KEY: z.string().min(1).optional(),
    MOBBEX_ACCESS_TOKEN: z.string().min(1).optional(),
    MOBBEX_ENTITY_ID: z.string().min(1).optional(),
    MOBBEX_TEST_MODE: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default("true"),
    MERCADOPAGO_ACCESS_TOKEN: z.string().min(1).optional(),
    MERCADOPAGO_WEBHOOK_SECRET: z.string().min(1).optional(),
    PAYWAY_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
    PAYWAY_SITE_ID: z.string().min(1).optional(),
    PAYWAY_PRIVATE_API_KEY: z.string().min(1).optional(),
    PAYWAY_DEBIT_RELEASE_BUSINESS_DAYS: z.coerce
      .number()
      .int()
      .min(0)
      .max(60)
      .optional(),
    PAYWAY_CREDIT_RELEASE_BUSINESS_DAYS: z.coerce
      .number()
      .int()
      .min(0)
      .max(60)
      .optional(),
    APP_URL: z.string().url().default("http://localhost:3000"),
    RESEND_API_KEY: z.string().min(1).optional(),
    RECEIPT_EMAIL_FROM: z.string().min(3).optional(),



    MODO_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
    MODO_USERNAME: z.string().min(1).optional(),
    MODO_PASSWORD: z.string().min(1).optional(),
    MODO_PROCESSOR_CODE: z.string().min(1).max(50).optional(),
    MODO_CC_CODE: z.string().min(1).max(50).optional(),
    MODO_MERCHANT_NAME: z.string().min(1).max(100).optional(),


    // Facturación electrónica. "disabled" no emite comprobantes; "simulated"
    // emite comprobantes de prueba sin validez fiscal.
    INVOICING_PROVIDER: z
      .enum(["disabled", "simulated", "facturante"])
      .default("disabled"),
    INVOICING_ISSUER_TAX_CONDITION: z
      .enum(["MONOTRIBUTO", "RESPONSABLE_INSCRIPTO"])
      .default("MONOTRIBUTO"),
    INVOICING_POINT_OF_SALE: z.coerce.number().int().min(1).max(99998).optional(),
    INVOICING_CLUB_ITEMS_MODE: z.enum(["TOTAL", "STORE_SHARE"]).default("TOTAL"),
    INVOICING_VAT_RATE: z.coerce.number().min(0).max(100).default(21),
    FACTURANTE_ENVIRONMENT: z.enum(["testing", "production"]).default("testing"),
    FACTURANTE_USER: z.string().min(1).optional(),
    FACTURANTE_PASSWORD: z.string().min(1).optional(),
    FACTURANTE_COMPANY_ID: z.string().min(1).optional(),
    FACTURANTE_WEBHOOK_SECRET: z.string().min(16).optional(),

    CRON_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string().min(16)
        : z.string().min(16).optional(),
  },






  client: {
    NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_PAYWAY_PUBLIC_API_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_PAYWAY_ENVIRONMENT: z
      .enum(["sandbox", "production"])
      .default("sandbox"),
    NEXT_PUBLIC_PAYWAY_INSTALLMENTS: z.string().default("1"),
  },





  runtimeEnv: {
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    AUTH_URL: process.env.AUTH_URL,
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    PRISMA_CONNECTION_LIMIT: process.env.PRISMA_CONNECTION_LIMIT,
    PRISMA_POOL_TIMEOUT_SECONDS: process.env.PRISMA_POOL_TIMEOUT_SECONDS,
    UNPAID_ORDER_EXPIRATION_HOURS: process.env.UNPAID_ORDER_EXPIRATION_HOURS,
    NODE_ENV: process.env.NODE_ENV,
    MOBBEX_API_KEY: process.env.MOBBEX_API_KEY,
    MOBBEX_ACCESS_TOKEN: process.env.MOBBEX_ACCESS_TOKEN,
    MOBBEX_ENTITY_ID: process.env.MOBBEX_ENTITY_ID,
    MOBBEX_TEST_MODE: process.env.MOBBEX_TEST_MODE,
    MERCADOPAGO_ACCESS_TOKEN: process.env.MERCADOPAGO_ACCESS_TOKEN,
    MERCADOPAGO_WEBHOOK_SECRET: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    PAYWAY_ENVIRONMENT: process.env.PAYWAY_ENVIRONMENT,
    PAYWAY_SITE_ID: process.env.PAYWAY_SITE_ID,
    PAYWAY_PRIVATE_API_KEY: process.env.PAYWAY_PRIVATE_API_KEY,
    PAYWAY_DEBIT_RELEASE_BUSINESS_DAYS:
      process.env.PAYWAY_DEBIT_RELEASE_BUSINESS_DAYS,
    PAYWAY_CREDIT_RELEASE_BUSINESS_DAYS:
      process.env.PAYWAY_CREDIT_RELEASE_BUSINESS_DAYS,
    APP_URL: process.env.APP_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RECEIPT_EMAIL_FROM: process.env.RECEIPT_EMAIL_FROM,
    CRON_SECRET: process.env.CRON_SECRET,
    INVOICING_PROVIDER: process.env.INVOICING_PROVIDER,
    INVOICING_ISSUER_TAX_CONDITION: process.env.INVOICING_ISSUER_TAX_CONDITION,
    INVOICING_POINT_OF_SALE: process.env.INVOICING_POINT_OF_SALE,
    INVOICING_CLUB_ITEMS_MODE: process.env.INVOICING_CLUB_ITEMS_MODE,
    INVOICING_VAT_RATE: process.env.INVOICING_VAT_RATE,
    FACTURANTE_ENVIRONMENT: process.env.FACTURANTE_ENVIRONMENT,
    FACTURANTE_USER: process.env.FACTURANTE_USER,
    FACTURANTE_PASSWORD: process.env.FACTURANTE_PASSWORD,
    FACTURANTE_COMPANY_ID: process.env.FACTURANTE_COMPANY_ID,
    FACTURANTE_WEBHOOK_SECRET: process.env.FACTURANTE_WEBHOOK_SECRET,
    MODO_ENVIRONMENT: process.env.MODO_ENVIRONMENT,
    MODO_USERNAME: process.env.MODO_USERNAME,
    MODO_PASSWORD: process.env.MODO_PASSWORD,
    MODO_PROCESSOR_CODE: process.env.MODO_PROCESSOR_CODE,
    MODO_CC_CODE: process.env.MODO_CC_CODE,
    MODO_MERCHANT_NAME: process.env.MODO_MERCHANT_NAME,
    NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY:
      process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY,
    NEXT_PUBLIC_PAYWAY_PUBLIC_API_KEY:
      process.env.NEXT_PUBLIC_PAYWAY_PUBLIC_API_KEY,
    NEXT_PUBLIC_PAYWAY_ENVIRONMENT: process.env.NEXT_PUBLIC_PAYWAY_ENVIRONMENT,
    NEXT_PUBLIC_PAYWAY_INSTALLMENTS:
      process.env.NEXT_PUBLIC_PAYWAY_INSTALLMENTS,
  },




  skipValidation: !!process.env.SKIP_ENV_VALIDATION,




  emptyStringAsUndefined: true,
});
