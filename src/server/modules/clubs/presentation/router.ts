import { randomInt } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  adminMutationRateLimit,
  adminProcedure,
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  staffProcedure,
} from "elestampadero/server/api/trpc";
import { clubCanSellWhere } from "elestampadero/server/modules/catalog";
import { hashPassword } from "elestampadero/server/modules/identity-access/application/verify-credentials";

import { getClubBySlug } from "../application/use-cases/get-club-by-slug";
import { listClubs } from "../application/use-cases/list-clubs";
import { prismaClubsRepository } from "../infrastructure/persistence/prisma-clubs-repository";

const listClubsUseCase = listClubs(prismaClubsRepository);
const getClubBySlugUseCase = getClubBySlug(prismaClubsRepository);

const ADMIN_ROLES = new Set(["ADMIN", "SUPER_ADMIN"]);
const CLUB_MANAGER_ROLES = new Set(["CLUB_ADMIN", "ADMIN", "SUPER_ADMIN"]);

const clubIdSchema = z.object({ clubId: z.string().min(1).max(60) });

const mobbexOnboardingDetailsSchema = clubIdSchema.extend({
  legalName: z.string().trim().min(2).max(160),
  taxId: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .pipe(z.string().length(11, "El CUIT debe tener 11 dígitos.")),
  contactName: z.string().trim().min(2).max(120),
  contactEmail: z.string().trim().email().max(254),
  contactPhone: z.string().trim().min(6).max(40),
  entityId: z.string().trim().max(120).optional(),
});

const createClubSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sport: z.string().trim().max(100).optional(),
  description: z.string().trim().max(1200).optional(),
  logoUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(
      (value) => value === "" || value.startsWith("/") || URL.canParse(value),
      "Ingresá una URL o ruta de imagen válida.",
    )
    .optional(),
  adminName: z.string().trim().min(2).max(120),
  isActive: z.boolean().default(true),
});

function slugifyClubName(name: string) {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "club"
  );
}

function generateInitialPassword(length = 16) {
  const groups = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!@#$%&*?",
  ];
  const allCharacters = groups.join("");
  const characters = groups.map((group) => group[randomInt(0, group.length)]!);

  while (characters.length < length) {
    characters.push(allCharacters[randomInt(0, allCharacters.length)]!);
  }

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex]!,
      characters[index]!,
    ];
  }

  return characters.join("");
}

async function assertClubAccess(userId: string, role: string, clubId: string) {
  if (ADMIN_ROLES.has(role)) return;
  const clubIds = await prismaClubsRepository.listClubIdsForUser(userId);
  if (!clubIds.includes(clubId)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}

async function assertClubManagement(
  userId: string,
  role: string,
  clubId: string,
) {
  await assertClubAccess(userId, role, clubId);
  if (!CLUB_MANAGER_ROLES.has(role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tu usuario tiene acceso de solo lectura.",
    });
  }
}

export const clubsRouter = createTRPCRouter({
  publicList: publicProcedure.query(async ({ ctx }) => {
    const clubs = await ctx.db.club.findMany({
      where: { isActive: true },
      select: {
        slug: true,
        name: true,
        sport: true,
        description: true,
        logoUrl: true,
        _count: {
          select: {
            products: {
              where: {
                status: "PUBLISHED",
                club: clubCanSellWhere,
                OR: [
                  { variants: { some: { stock: { gt: 0 } } } },
                  { showStock: false, variants: { some: { stock: null } } },
                ],
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });

    return clubs.map((club) => ({
      slug: club.slug,
      name: club.name,
      sport: club.sport,
      description: club.description,
      logoUrl: club.logoUrl,
      productCount: club._count.products,
    }));
  }),

  publicBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const club = await ctx.db.club.findFirst({
        where: { slug: input.slug, isActive: true },
        select: {
          slug: true,
          name: true,
          sport: true,
          description: true,
          logoUrl: true,
          _count: {
            select: {
              products: {
                where: {
                  status: "PUBLISHED",
                  club: clubCanSellWhere,
                  OR: [
                    { variants: { some: { stock: { gt: 0 } } } },
                    { showStock: false, variants: { some: { stock: null } } },
                  ],
                },
              },
            },
          },
        },
      });

      if (!club) return null;
      return {
        slug: club.slug,
        name: club.name,
        sport: club.sport,
        description: club.description,
        logoUrl: club.logoUrl,
        productCount: club._count.products,
      };
    }),

  list: staffProcedure.query(() => listClubsUseCase()),

  create: adminProcedure
    .input(createClubSchema)
    .use(adminMutationRateLimit("clubs.create", { limit: 10 }))
    .mutation(async ({ ctx, input }) => {
      const initialPassword = generateInitialPassword();
      const passwordHash = await hashPassword(initialPassword);

      return ctx.db.$transaction(async (transaction) => {
        const baseSlug = slugifyClubName(input.name);
        let slug = baseSlug;
        let slugSuffix = 2;

        while (
          await transaction.club.findUnique({
            where: { slug },
            select: { id: true },
          })
        ) {
          slug = `${baseSlug}-${slugSuffix}`;
          slugSuffix += 1;
        }

        const emailSlug = slug.slice(0, 44);
        let email = `club.${emailSlug}@elestampadero.com`;
        let emailSuffix = 2;

        while (
          await transaction.user.findUnique({
            where: { email },
            select: { id: true },
          })
        ) {
          email = `club.${emailSlug}.${emailSuffix}@elestampadero.com`;
          emailSuffix += 1;
        }

        const club = await transaction.club.create({
          data: {
            name: input.name,
            slug,
            sport: input.sport ?? null,
            description: input.description ?? null,
            logoUrl: input.logoUrl ?? null,
            isActive: input.isActive,
          },
          select: { id: true, name: true, slug: true },
        });

        const user = await transaction.user.create({
          data: {
            name: input.adminName,
            email,
            passwordHash,
            mustChangePassword: true,
            role: "CLUB_ADMIN",
            isActive: true,
          },
          select: { id: true },
        });

        await transaction.clubUser.create({
          data: { clubId: club.id, userId: user.id },
        });

        return {
          club,
          credentials: { email, password: initialPassword },
          portalPath: "/club",
        };
      });
    }),

  bySlug: staffProcedure
    .input(z.object({ slug: z.string().min(1).max(120) }))
    .query(({ input }) => getClubBySlugUseCase(input.slug)),

  accessAccount: adminProcedure
    .input(clubIdSchema)
    .query(async ({ ctx, input }) => {
      const membership = await ctx.db.clubUser.findFirst({
        where: {
          clubId: input.clubId,
          user: { role: "CLUB_ADMIN" },
        },
        orderBy: { user: { createdAt: "asc" } },
        select: {
          user: {
            select: { id: true, name: true, email: true, isActive: true },
          },
        },
      });

      return membership?.user ?? null;
    }),

  regenerateAccessPassword: adminProcedure
    .input(clubIdSchema)
    .use(adminMutationRateLimit("clubs.regenerateAccessPassword", { limit: 5 }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.db.clubUser.findFirst({
        where: {
          clubId: input.clubId,
          user: { role: "CLUB_ADMIN" },
        },
        orderBy: { user: { createdAt: "asc" } },
        select: {
          user: { select: { id: true, email: true } },
        },
      });

      if (!membership?.user.email) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No se encontró la cuenta de acceso de este socio.",
        });
      }

      const password = generateInitialPassword();
      const passwordHash = await hashPassword(password);
      await ctx.db.$transaction([
        ctx.db.user.update({
          where: { id: membership.user.id },
          data: { passwordHash, mustChangePassword: true },
        }),
        ctx.db.session.deleteMany({
          where: { userId: membership.user.id },
        }),
      ]);

      return { email: membership.user.email, password };
    }),

  updatePayoutAccount: adminProcedure
    .input(
      z.object({
        clubId: z.string().min(1).max(60),
        payoutCbu: z
          .string()
          .trim()
          .regex(/^\d{22}$/, "El CBU o CVU debe tener exactamente 22 dígitos."),
      }),
    )
    .use(adminMutationRateLimit("clubs.updatePayoutAccount"))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.club.update({
        where: { id: input.clubId },
        data: { payoutCbu: input.payoutCbu },
      });
      return { success: true };
    }),

  updateMobbexEntity: adminProcedure
    .input(
      z.object({
        clubId: z.string().min(1).max(60),
        mobbexEntityId: z.string().trim().min(2).max(120),
      }),
    )
    .use(adminMutationRateLimit("clubs.updateMobbexEntity"))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.club.update({
        where: { id: input.clubId },
        data: {
          mobbexEntityId: input.mobbexEntityId,
          mobbexOnboardingStatus: "ACTIVE",
          mobbexActivatedAt: new Date(),
        },
      });
      return { success: true };
    }),

  startMobbexOnboarding: protectedProcedure
    .input(clubIdSchema.extend({ hasAccount: z.boolean() }))
    .use(adminMutationRateLimit("clubs.startMobbexOnboarding", { limit: 10 }))
    .mutation(async ({ ctx, input }) => {
      await assertClubManagement(
        ctx.session.user.id,
        ctx.session.user.role,
        input.clubId,
      );
      const club = await ctx.db.club.findUnique({
        where: { id: input.clubId },
        select: { mobbexOnboardingStatus: true },
      });
      if (!club) throw new TRPCError({ code: "NOT_FOUND" });
      if (club.mobbexOnboardingStatus === "ACTIVE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La cuenta Mobbex del club ya está activa.",
        });
      }
      await ctx.db.club.update({
        where: { id: input.clubId },
        data: {
          mobbexOnboardingStatus: input.hasAccount
            ? "NOT_STARTED"
            : "REGISTRATION_PENDING",
        },
      });
      return { success: true };
    }),

  submitMobbexOnboarding: protectedProcedure
    .input(mobbexOnboardingDetailsSchema)
    .use(adminMutationRateLimit("clubs.submitMobbexOnboarding", { limit: 10 }))
    .mutation(async ({ ctx, input }) => {
      await assertClubManagement(
        ctx.session.user.id,
        ctx.session.user.role,
        input.clubId,
      );
      const club = await ctx.db.club.findUnique({
        where: { id: input.clubId },
        select: { mobbexOnboardingStatus: true },
      });
      if (!club) throw new TRPCError({ code: "NOT_FOUND" });
      if (club.mobbexOnboardingStatus === "ACTIVE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La cuenta Mobbex del club ya está activa.",
        });
      }
      await ctx.db.club.update({
        where: { id: input.clubId },
        data: {
          mobbexLegalName: input.legalName,
          mobbexTaxId: input.taxId,
          mobbexContactName: input.contactName,
          mobbexContactEmail: input.contactEmail.toLowerCase(),
          mobbexContactPhone: input.contactPhone,
          mobbexSubmittedEntityId:
            input.entityId === "" ? null : (input.entityId ?? null),
          mobbexOnboardingStatus: "DETAILS_SUBMITTED",
          mobbexSubmittedAt: new Date(),
          mobbexAccessRequestedAt: null,
          mobbexAuthorizationConfirmedAt: null,
        },
      });
      return { success: true };
    }),

  confirmMobbexAuthorization: protectedProcedure
    .input(clubIdSchema)
    .use(
      adminMutationRateLimit("clubs.confirmMobbexAuthorization", {
        limit: 10,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertClubManagement(
        ctx.session.user.id,
        ctx.session.user.role,
        input.clubId,
      );
      const club = await ctx.db.club.findUnique({
        where: { id: input.clubId },
        select: { mobbexOnboardingStatus: true },
      });
      if (!club) throw new TRPCError({ code: "NOT_FOUND" });
      if (club.mobbexOnboardingStatus !== "ACCESS_REQUESTED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "El administrador todavía no marcó la solicitud como enviada.",
        });
      }
      await ctx.db.club.update({
        where: { id: input.clubId },
        data: {
          mobbexOnboardingStatus: "AUTHORIZATION_CONFIRMED",
          mobbexAuthorizationConfirmedAt: new Date(),
        },
      });
      return { success: true };
    }),

  markMobbexAccessRequested: adminProcedure
    .input(clubIdSchema)
    .use(adminMutationRateLimit("clubs.markMobbexAccessRequested"))
    .mutation(async ({ ctx, input }) => {
      const club = await ctx.db.club.findUnique({
        where: { id: input.clubId },
        select: { mobbexOnboardingStatus: true, mobbexTaxId: true },
      });
      if (!club) throw new TRPCError({ code: "NOT_FOUND" });
      if (
        club.mobbexOnboardingStatus !== "DETAILS_SUBMITTED" ||
        !club.mobbexTaxId
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El club todavía no completó sus datos de vinculación.",
        });
      }
      await ctx.db.club.update({
        where: { id: input.clubId },
        data: {
          mobbexOnboardingStatus: "ACCESS_REQUESTED",
          mobbexAccessRequestedAt: new Date(),
        },
      });
      return { success: true };
    }),

  activateMobbexOnboarding: adminProcedure
    .input(
      clubIdSchema.extend({
        entityId: z.string().trim().min(2).max(120),
      }),
    )
    .use(adminMutationRateLimit("clubs.activateMobbexOnboarding"))
    .mutation(async ({ ctx, input }) => {
      const club = await ctx.db.club.findUnique({
        where: { id: input.clubId },
        select: { mobbexOnboardingStatus: true },
      });
      if (!club) throw new TRPCError({ code: "NOT_FOUND" });
      if (club.mobbexOnboardingStatus !== "AUTHORIZATION_CONFIRMED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El club todavía no confirmó la autorización en Mobbex.",
        });
      }
      await ctx.db.club.update({
        where: { id: input.clubId },
        data: {
          mobbexEntityId: input.entityId,
          mobbexSubmittedEntityId: input.entityId,
          mobbexOnboardingStatus: "ACTIVE",
          mobbexActivatedAt: new Date(),
        },
      });
      return { success: true };
    }),

  returnMobbexOnboardingForReview: adminProcedure
    .input(clubIdSchema)
    .use(adminMutationRateLimit("clubs.returnMobbexOnboardingForReview"))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.club.update({
        where: { id: input.clubId },
        data: {
          mobbexOnboardingStatus: "DETAILS_SUBMITTED",
          mobbexAccessRequestedAt: null,
          mobbexAuthorizationConfirmedAt: null,
        },
      });
      return { success: true };
    }),

  myClubs: protectedProcedure.query(async ({ ctx }) => {
    if (ADMIN_ROLES.has(ctx.session.user.role)) {
      return prismaClubsRepository.listClubs();
    }
    const clubIds = await prismaClubsRepository.listClubIdsForUser(
      ctx.session.user.id,
    );
    const clubs = await Promise.all(
      clubIds.map((id) => prismaClubsRepository.getClubById(id)),
    );
    return clubs.filter((club) => club !== null);
  }),

  portalData: protectedProcedure
    .input(clubIdSchema)
    .query(async ({ ctx, input }) => {
      await assertClubAccess(
        ctx.session.user.id,
        ctx.session.user.role,
        input.clubId,
      );

      const [club, orders, currentUser] = await Promise.all([
        ctx.db.club.findUnique({
          where: { id: input.clubId },
          select: {
            id: true,
            name: true,
            slug: true,
            sport: true,
            description: true,
            logoUrl: true,
            isActive: true,
            payoutCbu: true,
            mobbexEntityId: true,
            mobbexSubmittedEntityId: true,
            mobbexOnboardingStatus: true,
            mobbexTaxId: true,
            mobbexLegalName: true,
            mobbexContactName: true,
            mobbexContactEmail: true,
            mobbexContactPhone: true,
            mobbexSubmittedAt: true,
            mobbexAccessRequestedAt: true,
            mobbexAuthorizationConfirmedAt: true,
            mobbexActivatedAt: true,
            products: {
              orderBy: { name: "asc" },
              select: {
                id: true,
                slug: true,
                code: true,
                name: true,
                priceInCents: true,
                status: true,
                line: true,
                images: {
                  orderBy: { position: "asc" },
                  take: 1,
                  select: { url: true, alt: true },
                },
                variants: { select: { stock: true } },
                _count: { select: { designLinks: true } },
              },
            },
            users: {
              orderBy: { user: { name: "asc" } },
              select: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    isActive: true,
                    mustChangePassword: true,
                  },
                },
              },
            },
          },
        }),
        ctx.db.order.findMany({
          where: { items: { some: { clubId: input.clubId } } },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            deliveryMethod: true,
            createdAt: true,
            productionBatch: {
              select: {
                id: true,
                batchNumber: true,
                status: true,
                createdAt: true,
                closedAt: true,
              },
            },
            items: {
              where: { clubId: input.clubId },
              select: {
                id: true,
                productName: true,
                quantity: true,
                size: true,
                color: true,
                lineTotalInCents: true,
              },
            },
          },
        }),
        ctx.db.user.findUnique({
          where: { id: ctx.session.user.id },
          select: { mustChangePassword: true },
        }),
      ]);

      if (!club) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Club no encontrado.",
        });
      }

      const mappedOrders = orders.map((order) => ({
        ...order,
        createdAt: order.createdAt.toISOString(),
        productionBatch: order.productionBatch
          ? {
              ...order.productionBatch,
              createdAt: order.productionBatch.createdAt.toISOString(),
              closedAt: order.productionBatch.closedAt?.toISOString() ?? null,
            }
          : null,
        unitCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        clubTotalInCents: order.items.reduce(
          (sum, item) => sum + item.lineTotalInCents,
          0,
        ),
      }));

      const batchById = new Map<
        string,
        {
          id: string;
          batchNumber: number;
          status: string;
          createdAt: string;
          closedAt: string | null;
          orderIds: Set<string>;
          unitCount: number;
        }
      >();

      for (const order of mappedOrders) {
        if (!order.productionBatch) continue;
        const existing = batchById.get(order.productionBatch.id);
        if (existing) {
          existing.orderIds.add(order.id);
          existing.unitCount += order.unitCount;
        } else {
          batchById.set(order.productionBatch.id, {
            ...order.productionBatch,
            orderIds: new Set([order.id]),
            unitCount: order.unitCount,
          });
        }
      }

      return {
        club: {
          id: club.id,
          name: club.name,
          slug: club.slug,
          sport: club.sport,
          description: club.description,
          logoUrl: club.logoUrl,
          isActive: club.isActive,
          payoutCbu: club.payoutCbu,
          mobbexEntityId: club.mobbexEntityId,
          mobbexSubmittedEntityId: club.mobbexSubmittedEntityId,
          mobbexOnboardingStatus: club.mobbexOnboardingStatus,
          mobbexTaxId: club.mobbexTaxId,
          mobbexLegalName: club.mobbexLegalName,
          mobbexContactName: club.mobbexContactName,
          mobbexContactEmail: club.mobbexContactEmail,
          mobbexContactPhone: club.mobbexContactPhone,
          mobbexSubmittedAt: club.mobbexSubmittedAt?.toISOString() ?? null,
          mobbexAccessRequestedAt:
            club.mobbexAccessRequestedAt?.toISOString() ?? null,
          mobbexAuthorizationConfirmedAt:
            club.mobbexAuthorizationConfirmedAt?.toISOString() ?? null,
          mobbexActivatedAt: club.mobbexActivatedAt?.toISOString() ?? null,
        },
        products: club.products.map((product) => ({
          id: product.id,
          slug: product.slug,
          code: product.code,
          name: product.name,
          priceInCents: product.priceInCents,
          status: product.status,
          line: product.line,
          imageUrl: product.images[0]?.url ?? null,
          imageAlt: product.images[0]?.alt ?? product.name,
          totalStock: product.variants.reduce(
            (sum, variant) => sum + (variant.stock ?? 0),
            0,
          ),
          linkedDesignCount: product._count.designLinks,
        })),
        orders: mappedOrders,
        batches: [...batchById.values()]
          .map(({ orderIds, ...batch }) => ({
            ...batch,
            orderCount: orderIds.size,
          }))
          .sort((a, b) => b.batchNumber - a.batchNumber),
        users: club.users.map(({ user }) => {
          const { mustChangePassword: _mustChangePassword, ...safeUser } = user;
          return safeUser;
        }),
        mustChangePassword: currentUser?.mustChangePassword ?? false,
        canManageMembers: CLUB_MANAGER_ROLES.has(ctx.session.user.role),
        canReviewDesigns: CLUB_MANAGER_ROLES.has(ctx.session.user.role),
      };
    }),

  addMember: protectedProcedure
    .input(clubIdSchema.extend({ email: z.string().trim().email().max(254) }))
    .use(adminMutationRateLimit("clubs.addMember", { limit: 15 }))
    .mutation(async ({ ctx, input }) => {
      await assertClubManagement(
        ctx.session.user.id,
        ctx.session.user.role,
        input.clubId,
      );

      const email = input.email.toLowerCase();
      const user = await ctx.db.user.findUnique({ where: { email } });
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Ese correo todavía no tiene una cuenta registrada.",
        });
      }
      if (user.role === "PRODUCTION_OPERATOR") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Un usuario interno de producción no puede sumarse al portal.",
        });
      }

      await ctx.db.$transaction(async (tx) => {
        await tx.clubUser.upsert({
          where: {
            clubId_userId: { clubId: input.clubId, userId: user.id },
          },
          update: {},
          create: { clubId: input.clubId, userId: user.id },
        });
        if (user.role === "CUSTOMER") {
          await tx.user.update({
            where: { id: user.id },
            data: { role: "CLUB_VIEWER" },
          });
        }
      });

      return { success: true };
    }),

  removeMember: protectedProcedure
    .input(clubIdSchema.extend({ userId: z.string().min(1).max(60) }))
    .use(adminMutationRateLimit("clubs.removeMember", { limit: 15 }))
    .mutation(async ({ ctx, input }) => {
      await assertClubManagement(
        ctx.session.user.id,
        ctx.session.user.role,
        input.clubId,
      );
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No podés quitar tu propio acceso.",
        });
      }

      const membership = await ctx.db.clubUser.findUnique({
        where: {
          clubId_userId: { clubId: input.clubId, userId: input.userId },
        },
        include: { user: { select: { role: true } } },
      });
      if (!membership) return { success: true };

      await ctx.db.$transaction(async (tx) => {
        await tx.clubUser.delete({ where: { id: membership.id } });
        const remainingMemberships = await tx.clubUser.count({
          where: { userId: input.userId },
        });
        if (
          remainingMemberships === 0 &&
          ["CLUB_ADMIN", "CLUB_VIEWER"].includes(membership.user.role)
        ) {
          await tx.user.update({
            where: { id: input.userId },
            data: { role: "CUSTOMER" },
          });
        }
      });

      return { success: true };
    }),
});
