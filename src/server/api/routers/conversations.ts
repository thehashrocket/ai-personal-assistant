// src/server/api/routers/conversations.ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const conversationRouter = createTRPCRouter({
    getOrCreate: protectedProcedure
        .input(z.object({ conversationId: z.string().optional() }))
        .mutation(async ({ ctx, input }) => {
            console.log('getOrCreate input:', input);
            if (input.conversationId) {
                const existingConversation = await ctx.db.conversation.findUnique({
                    where: { id: input.conversationId },
                    include: { messages: true },
                });
                if (existingConversation) {
                    return existingConversation;
                }
            }

            const result = await ctx.db.conversation.create({
                data: { userId: ctx.session.user.id },
                include: { messages: true },
            });
            console.log('getOrCreate result:', result);
            return result;
        }),

    getPreviousMessages: protectedProcedure
        .input(z.object({ conversationId: z.string() }))
        .query(async ({ ctx, input }) => {
            console.log('getPreviousMessages input:', input);
            const messages = await ctx.db.message.findMany({
                where: { conversationId: input.conversationId },
                orderBy: { createdAt: 'asc' },
            });
            console.log('getPreviousMessages messages:', messages);
            return messages.map(message => ({
                role: message.role,
                content: message.content,
            }));
        }),

    saveMessage: protectedProcedure
        .input(z.object({
            conversationId: z.string(),
            role: z.enum(['user', 'assistant']),
            content: z.string(),
        }))
        .mutation(async ({ ctx, input }) => {
            const conversation = await ctx.db.conversation.findUnique({
                where: { id: input.conversationId },
            });

            if (!conversation) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Conversation not found',
                });
            }

            return await ctx.db.message.create({
                data: {
                    conversationId: input.conversationId,
                    role: input.role,
                    content: input.content,
                },
            });
        }),
});