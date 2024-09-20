import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { google } from 'googleapis';
import { TRPCError } from "@trpc/server";

export const googleCalendarRouter = createTRPCRouter({
    getAuthUrl: protectedProcedure.query(({ ctx }) => {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );
        const scopes = ['https://www.googleapis.com/auth/calendar'];
        const url = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
        });
        return url;
    }),

    handleCallback: protectedProcedure
        .input(z.object({ code: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            const { tokens } = await oauth2Client.getToken(input.code);
            await ctx.db.token.upsert({
                where: {
                    provider_userId: {
                        provider: 'google',
                        userId: ctx.session.user.id,
                    }
                },
                update: {
                    accessToken: tokens.access_token!,
                    refreshToken: tokens.refresh_token!,
                    expiryDate: new Date(tokens.expiry_date!),
                },
                create: {
                    provider: 'google',
                    userId: ctx.session.user.id,
                    accessToken: tokens.access_token!,
                    refreshToken: tokens.refresh_token!,
                    expiryDate: new Date(tokens.expiry_date!),
                },
            });
            return { success: true };
        }),

    createEvent: protectedProcedure
        .input(z.object({
            summary: z.string(),
            description: z.string(),
            start: z.string(),
            end: z.string(),
        }))
        .mutation(async ({ ctx, input }): Promise<any> => {
            const token = await ctx.db.token.findUnique({
                where: {
                    provider_userId: {
                        provider: 'google',
                        userId: ctx.session.user.id,
                    }
                },
            });

            if (!token) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'User not authenticated with Google Calendar',
                });
            }
            console.log('token', token);
            console.log('input', input);

            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            oauth2Client.setCredentials({
                access_token: token.accessToken,
                refresh_token: token.refreshToken,
                expiry_date: token.expiryDate?.getTime(),
            });

            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

            try {
                const response = await calendar.events.insert({
                    calendarId: 'primary',
                    requestBody: {
                        summary: input.summary,
                        description: input.description,
                        start: { dateTime: input.start, timeZone: 'UTC' },
                        end: { dateTime: input.end, timeZone: 'UTC' },
                    },
                });
                console.log('response', response);
                return response.data;
            } catch (error) {
                console.error('Error creating event:', error);
                if (error.response?.status === 401) {
                    // Token might be expired, try to refresh
                    try {
                        const { tokens } = await oauth2Client.refreshAccessToken();
                        await ctx.db.token.update({
                            where: { id: token.id },
                            data: {
                                accessToken: tokens.access_token!,
                                expiryDate: new Date(tokens.expiry_date!),
                            },
                        });
                        // Retry with new token
                        oauth2Client.setCredentials(tokens);
                        const response = await calendar.events.insert({
                            calendarId: 'primary',
                            requestBody: {
                                summary: input.summary,
                                description: input.description,
                                start: { dateTime: input.start, timeZone: 'UTC' },
                                end: { dateTime: input.end, timeZone: 'UTC' },
                            },
                        });
                        return response.data;
                    } catch (refreshError) {
                        console.error('Error refreshing token:', refreshError);
                        throw new TRPCError({
                            code: 'UNAUTHORIZED',
                            message: 'Failed to refresh Google Calendar token',
                        });
                    }
                }
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Error creating event in Google Calendar',
                });
            }
        }),

    listEvents: protectedProcedure
        .input(z.object({
            timeMin: z.string().optional(),
            timeMax: z.string().optional(),
        }))
        .query(async ({ ctx, input }) => {
            const token = await ctx.db.token.findUnique({
                where: {
                    provider_userId: {
                        provider: 'google',
                        userId: ctx.session.user.id,
                    }
                },
            });

            if (!token) {
                throw new TRPCError({
                    code: 'UNAUTHORIZED',
                    message: 'User not authenticated with Google Calendar',
                });
            }

            const oauth2Client = new google.auth.OAuth2(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                process.env.GOOGLE_REDIRECT_URI
            );
            oauth2Client.setCredentials({
                access_token: token.accessToken,
                refresh_token: token.refreshToken,
            });

            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

            try {
                const response = await calendar.events.list({
                    calendarId: 'primary',
                    timeMin: input.timeMin || new Date().toISOString(),
                    timeMax: input.timeMax || new Date(new Date().setDate(new Date().getDate() + 7)).toISOString(), // Default to a week from now
                    singleEvents: true,
                    orderBy: 'startTime',
                });

                return response.data.items;
            } catch (error) {
                if (error.response?.status === 401) {
                    // Token might be expired, try to refresh
                    const { tokens } = await oauth2Client.refreshAccessToken();
                    await ctx.db.token.update({
                        where: { id: token.id },
                        data: {
                            accessToken: tokens.access_token!,
                            expiryDate: new Date(tokens.expiry_date!),
                        },
                    });
                    // Retry with new token
                    oauth2Client.setCredentials(tokens);
                    const response = await calendar.events.list({
                        calendarId: 'primary',
                        timeMin: input.timeMin || new Date().toISOString(),
                        timeMax: input.timeMax || new Date(new Date().setDate(new Date().getDate() + 7)).toISOString(),
                        singleEvents: true,
                        orderBy: 'startTime',
                    });
                    return response.data.items;
                }
                throw error;
            }
        }),
});