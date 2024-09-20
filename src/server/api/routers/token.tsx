import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { Token } from "@prisma/client";

export const tokenRouter = createTRPCRouter({
    getByUserAndProvider: protectedProcedure
        .input(z.object({
            provider: z.string(),
        }))
        .query(async ({ ctx, input }) => {
            try {
                const token = await ctx.db.token.findUnique({
                    where: {
                        provider_userId: {
                            provider: input.provider,
                            userId: ctx.session.user.id,
                        },
                    },
                });

                if (!token) {
                    console.log(`No token found for user ${ctx.session.user.id} and provider ${input.provider}`);
                    return null; // Return null instead of throwing an error
                }

                return token;
            } catch (error) {
                console.error('Error in getByUserAndProvider:', error);
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'An error occurred while fetching the token',
                });
            }
        }),

    create: protectedProcedure
        .input(z.object({
            accessToken: z.string(),
            expiryDate: z.string(),
            provider: z.string(),
            refreshToken: z.string()
        }))
        .mutation(async ({ ctx, input }): Promise<Token> => {
            const token = await ctx.db.token.create({
                data: {
                    ...input,
                    userId: ctx.session.user.id,
                    expiryDate: new Date(input.expiryDate),
                },
            });

            return token;
        }),

    update: protectedProcedure
        .input(z.object({
            accessToken: z.string(),
            expiryDate: z.string(),
            provider: z.string(),
            refreshToken: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }): Promise<Token> => {
            const token = await ctx.db.token.update({
                where: {
                    provider_userId: {
                        provider: input.provider,
                        userId: ctx.session.user.id,
                    },
                },
                data: input,
            });

            return token;
        }),

    delete: protectedProcedure
        .input(z.object({
            provider: z.string(),
        }))
        .mutation(async ({ ctx, input }): Promise<Token> => {
            const token = await ctx.db.token.delete({
                where: {
                    provider_userId: {
                        provider: input.provider,
                        userId: ctx.session.user.id,
                    },
                },
            });

            return token;
        }),
});