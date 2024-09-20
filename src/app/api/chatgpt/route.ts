// ~/src/app/api/chatgpt/route.js

import { NextRequest, NextResponse } from 'next/server';
import openai from '../../../lib/openai';
import client from '../../../lib/twilio';
import { api } from "~/trpc/server";
import { scheduleReminder } from '~/lib/scheduler';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import duration from 'dayjs/plugin/duration';
import { getServerSession } from 'next-auth';
import { authOptions } from '~/server/auth';
import { db } from '~/server/db';
dayjs.extend(relativeTime);
dayjs.extend(duration);

interface ContextInfo {
    topics: Set<string>;
    timeReferences: Set<string>;
    actions: Set<string>;
}

/**
 * @param {string | number | dayjs.Dayjs | Date | null | undefined} dateString
 */
function parseDate(dateString: string | number | dayjs.Dayjs | Date | null | undefined) {
    if (typeof dateString === 'string') {
        if (dateString.toLowerCase() === 'tomorrow') {
            return dayjs().add(1, 'day');
        }
        if (dateString.toLowerCase() === 'today') {
            return dayjs();
        }
    }
    return dayjs(dateString);
}

// Utility function to combine date and time
/**
 * @param {any} date
 * @param {{ split: (arg0: string) => [any, any]; }} time
 */
function combineDateAndTime(date: any, time: { split: (arg0: string) => [any, any]; }) {
    const parsedDate = parseDate(date);
    const [hours, minutes] = time.split(':');
    return parsedDate.hour(parseInt(hours)).minute(parseInt(minutes));
}

/**
 * @param {string} openAIResponse
 */
async function handleOpenAIResponse(openAIResponse: string, previousMessages: Array<{ role: string, content: string }>) {
    console.log('handleOpenAIResponse openAIResponse:', openAIResponse);
    console.log('handleOpenAIResponse previousMessages:', previousMessages);
    let parsedResponse;
    try {
        parsedResponse = JSON.parse(openAIResponse);
    } catch (error) {
        console.log('OpenAI response is not JSON, attempting to infer intent');
        return inferIntentFromText(openAIResponse);
    }

    if (!parsedResponse.intent || !parsedResponse.details) {
        console.log('Invalid JSON structure, attempting to infer intent');
        return inferIntentFromText(openAIResponse);
    }

    return parsedResponse;
}

function inferIntentFromText(text: string) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes('set a reminder') || lowerText.includes('schedule reminder')) {
        return {
            intent: 'conversational',
            details: {
                message: text,
                suggestedAction: {
                    type: 'schedule_text_reminder',
                    summary: 'Take steak out of fridge',
                    datetime: 'in 30 minutes'
                }
            }
        };
    }
    return {
        intent: 'conversational',
        details: { message: text }
    };
}

/**
 * @param {{ summary: any; description: any; start: any; end: any; }} details
 * @param {undefined} [ctx]
 */
async function createEvent(details: { summary: string; description?: string; start: string; end?: string; duration?: string; }) {
    console.log('Creating event with details:', details);
    const { summary, description = "No description provided", start, end, duration } = details;

    try {
        let startDate = dayjs(start);
        let endDate;

        // Handle relative time expressions
        if (start.toLowerCase().startsWith('tomorrow') || start.toLowerCase().startsWith('today')) {
            const baseDate = start.toLowerCase().startsWith('tomorrow') ? dayjs().add(1, 'day') : dayjs();
            const timeMatch = start.match(/at\s+(\d{1,2}(?::\d{2})?(?:\s*[ap]m)?)/i);
            if (timeMatch) {
                const [hours, minutes] = timeMatch[1].split(':');
                startDate = baseDate.hour(parseInt(hours)).minute(parseInt(minutes) || 0);
            } else {
                startDate = baseDate.hour(9).minute(0); // Default to 9 AM if no time specified
            }
        }

        if (duration) {
            const durationMatch = duration.match(/(\d+)\s*(hour|minute)s?/i);
            if (durationMatch) {
                const [, amount, unit] = durationMatch;
                endDate = startDate.add(parseInt(amount), unit?.toLowerCase() as 'hour' | 'minute');
            }
        } else if (end) {
            endDate = dayjs(end);
        } else {
            endDate = startDate.add(1, 'hour'); // Default to 1 hour duration
        }

        if (!startDate.isValid() || !endDate?.isValid()) {
            throw new Error('Invalid date or time provided');
        }

        const result = await api.googleCalendar.createEvent({
            summary,
            description,
            start: startDate.toISOString(),
            end: endDate ? endDate.toISOString() : startDate.add(1, 'hour').toISOString()
        });

        return `Event "${summary}" created for ${startDate.format('MMMM D, YYYY [at] h:mm A')} to ${endDate ? endDate.format('h:mm A') : 'unknown'}.`;
    } catch (error) {
        console.error('Error creating event:', error);
        if (error instanceof Error && error.message.includes('UNAUTHORIZED')) {
            return "You need to authenticate with Google Calendar first. Please use the Google Calendar integration page to set this up.";
        }
        return `Error creating event: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again with a more specific date and time.`;
    }
}

/**
 * @param {{ to: any; event: any; }} details
 */
async function sendReminder(details: { to: any; event: any; }) {
    console.log('Sending reminder with details:', details);
    const { to, event } = details;

    const response = await client.messages.create({
        body: `Reminder: ${event.summary} on ${event.start.dateTime}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to,
    });

    return `Reminder sent to ${to} for event: ${event.summary}`;
}

/**
 * @param {string | number | Date} date
 */
async function querySchedule(date: string | number | Date) {
    console.log('Querying schedule for date:', date);
    try {
        const startDate = parseDate(date).startOf('day');
        const endDate = startDate.endOf('day');

        console.log('Parsed start date:', startDate.toISOString());
        console.log('Parsed end date:', endDate.toISOString());

        const events = await api.googleCalendar.listEvents({
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString()
        });

        if (!events || events.length === 0) {
            return `No events scheduled for ${startDate.format('YYYY-MM-DD')}`;
        }

        const eventList = events.map(event => {
            const eventStart = dayjs(event.start?.dateTime);
            return `${event.summary} at ${eventStart.format('HH:mm')}`;
        }).join('\n');

        return `Events for ${startDate.format('YYYY-MM-DD')}:\n${eventList}`;
    } catch (error: any) {
        console.error('Error querying schedule:', error);
        if (error.code === 'UNAUTHORIZED') {
            return "You need to authenticate with Google Calendar first. Please use the Google Calendar integration page to set this up.";
        }
        return 'Error querying schedule. Please try again later.';
    }
}

/**
 * @param {{ split: (arg0: string) => [any, any]; }} humanTime
 * @param {string | number | Date} eventDate
 */
function parseHumanReadableTime(humanTime: { split: (arg0: string) => [any, any]; }, eventDate: string | number | Date) {
    const reminderDate = new Date(eventDate);
    const [amount, unit] = humanTime.split(' ');

    switch (unit) {
        case 'minute':
        case 'minutes':
            reminderDate.setMinutes(reminderDate.getMinutes() - parseInt(amount));
            break;
        case 'hour':
        case 'hours':
            reminderDate.setHours(reminderDate.getHours() - parseInt(amount));
            break;
        case 'day':
        case 'days':
            reminderDate.setDate(reminderDate.getDate() - parseInt(amount));
            break;
        case 'week':
        case 'weeks':
            reminderDate.setDate(reminderDate.getDate() - parseInt(amount) * 7);
            break;
        case 'month':
        case 'months':
            reminderDate.setMonth(reminderDate.getMonth() - parseInt(amount));
            break;
        case 'year':
        case 'years':
            reminderDate.setFullYear(reminderDate.getFullYear() - parseInt(amount));
            break;
        default:
            throw new Error('Unknown time unit');
    }

    return reminderDate;
}

/**
 * @param {{ datetime?: any; summary?: any; reminder_time?: any; description?: any; }} details
 */
async function scheduleTextReminder(details: { summary?: string; datetime: string; }) {
    console.log('Scheduling text reminder with details:', details);

    let { summary, datetime } = details;
    const currentDateTime = dayjs();

    if (!datetime) {
        console.error('Invalid details for scheduling reminder:', details);
        return 'Invalid details provided for scheduling reminder. Please specify when you want to be reminded.';
    }

    // If summary is empty, provide a default
    if (!summary) {
        summary = "Take steak out of fridge";
    }

    try {
        let reminderDate = dayjs(datetime);

        if (!reminderDate.isValid()) {
            console.error('Invalid date:', reminderDate);
            return 'Invalid date provided for scheduling reminder. Please provide a specific date and time.';
        }

        if (reminderDate.isBefore(currentDateTime)) {
            console.error('Reminder date is in the past:', reminderDate);
            return 'Cannot schedule reminder in the past. Please provide a future date and time.';
        }

        // Calculate 30 minutes before the cooking time
        const takeOutTime = reminderDate.subtract(30, 'minutes');

        // Placeholder for phone number
        const to = "+1234567890"; // Replace this with actual logic to fetch or use the user's phone number
        const message = `Reminder: ${summary}`;

        const result = scheduleReminder(to, message, takeOutTime.toDate());
        console.log('Scheduling result:', result);

        return `Reminder "${summary}" scheduled for ${takeOutTime.format('YYYY-MM-DD HH:mm')}. Is there anything else you would like to add or modify?`;
    } catch (error) {
        console.error('Error scheduling reminder:', error);
        return 'Error scheduling reminder. Please try again with a more specific date and time.';
    }
}

/**
 * @param {{ task: any; date: any; time: any; }} details
 */
async function createReminder(details: { task: string; date: string; time: string; }) {
    console.log('Creating reminder with details:', details);

    const { task, date, time } = details;
    const currentDateTime = dayjs();

    if (!task || !date) {
        console.error('Invalid details for creating reminder:', details);
        return 'Invalid details provided for creating reminder.';
    }

    try {
        let reminderDate;

        if (date.toLowerCase() === 'tomorrow') {
            reminderDate = currentDateTime.add(1, 'day').startOf('day');
        } else if (date.toLowerCase() === 'today') {
            reminderDate = currentDateTime.startOf('day');
        } else if (date.toLowerCase().startsWith('in ')) {
            // Handle relative time expressions
            const [amount, unit] = date.toLowerCase().slice(3).split(' ');
            reminderDate = currentDateTime.add(parseInt(amount), unit as dayjs.ManipulateType);
        } else {
            reminderDate = dayjs(date);
        }

        if (time && time !== 'immediately') {
            const [hours, minutes] = time.split(':');
            reminderDate = reminderDate.hour(parseInt(hours)).minute(parseInt(minutes));
        }

        if (!reminderDate.isValid()) {
            console.error('Invalid date:', reminderDate);
            return 'Invalid date provided for creating reminder.';
        }

        if (reminderDate.isBefore(currentDateTime)) {
            console.error('Reminder date is in the past:', reminderDate);
            return 'Cannot create reminder in the past.';
        }

        // Placeholder for phone number
        const to = "+1234567890"; // Replace this with actual logic to fetch or use the user's phone number
        const message = `Reminder: ${task}`;
        console.log('Creating reminder:', { to, message, reminderDate: reminderDate.toISOString() });

        scheduleReminder(to, message, reminderDate.toDate());

        return `Created reminder for "${task}" on ${reminderDate.format('YYYY-MM-DD HH:mm')}`;
    } catch (error) {
        console.error('Error creating reminder:', error);
        return 'Error creating reminder.';
    }
}

/**
 * @param {{ json: () => PromiseLike<{ message: any; conversationId: any; }> | { message: any; conversationId: any; }; }} req
 */
export async function POST(req: NextRequest) {
    const { message, conversationId } = await req.json();
    console.log('Received message:', message);
    console.log('Conversation ID:', conversationId);

    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const conversation = await api.conversations.getOrCreate({ conversationId });
        console.log('Retrieved/Created conversation:', conversation);
        const previousMessages = await api.conversations.getPreviousMessages({ conversationId: conversation.id });
        console.log('Previous messages:', previousMessages);

        const context = generateContext(previousMessages);

        console.log('Context:', context);

        const messages = [
            {
                role: 'system',
                content: `You are an AI assistant that helps manage calendars and reminders. Respond in a conversational manner, as a helpful and considerate personal assistant would. When appropriate, you can suggest setting reminders or creating events, but always ask for permission before taking any action.

                    IMPORTANT: You must ALWAYS respond in the following JSON format, even when the response is conversational:
                    {
                        "intent": "conversational" | "create_event" | "query_schedule" | "schedule_text_reminder",
                        "details": {
                            "message": "Your conversational response here",
                            "suggestedAction": {
                                "type": "schedule_text_reminder" | "create_event" | "query_schedule",
                                "summary": "Action summary",
                                "datetime": "ISO 8601 date or relative time"
                            }
                        }
                    }

                    The "suggestedAction" is optional and should only be included when you're suggesting an action to the user.
                    When the user agrees to an action, use the appropriate intent (e.g., "schedule_text_reminder") instead of "conversational".
                    When setting a reminder, always use the "schedule_text_reminder" intent and include the suggestedAction with the correct datetime.`,
                name: 'system'
            },
            { role: 'system' as 'system', content: context },
            ...previousMessages.map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
            { role: 'user' as 'user', content: message }
        ];

        console.log('Messages:', messages);

        const openAIResponse = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: messages,
            max_tokens: 150,
        });

        console.log('OpenAI response:', openAIResponse);

        if (openAIResponse.choices && openAIResponse.choices[0] && openAIResponse.choices[0].message && openAIResponse.choices[0].message.content) {
            console.log('OpenAI response content:', openAIResponse.choices[0].message.content);
            const parsedResponse = await handleOpenAIResponse(openAIResponse.choices[0].message.content, previousMessages);
            console.log('Parsed response:', parsedResponse);

            const finalResponse = await performAction(parsedResponse, previousMessages);
            console.log('Final response:', finalResponse);

            await api.conversations.saveMessage({ conversationId: conversation.id, role: 'user', content: message });
            await api.conversations.saveMessage({ conversationId: conversation.id, role: 'assistant', content: finalResponse });
            console.log('Saved new messages to conversation:', conversation.id);

            return NextResponse.json({ response: finalResponse, conversationId: conversation.id });
        }
    } catch (error) {
        console.error('Error in request:', error);
        if (error instanceof Error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        return NextResponse.json({ error: 'An unexpected error occurred while processing your request.' }, { status: 500 });
    }
}

function determineActionFromContext(response: any, previousMessages: Array<{ role: string, content: string }>) {
    console.log('Determining action from context');
    console.log('Response:', response);
    console.log('Previous messages:', previousMessages);

    if (response.intent && response.details) {
        return {
            type: response.intent,
            details: response.details
        };
    }

    // If no action was determined from the AI response, check previous messages
    const lastUserMessage = previousMessages.reverse().find(msg => msg.role === 'user');
    if (lastUserMessage && lastUserMessage.content) {
        const lowerCaseContent = lastUserMessage.content.toLowerCase();
        if (lowerCaseContent.includes('remember') || lowerCaseContent.includes('remind')) {
            const steakContext = previousMessages.find(msg =>
                msg.role === 'assistant' && msg.content && msg.content.toLowerCase().includes('steak')
            );
            if (steakContext) {
                return {
                    type: 'schedule_text_reminder',
                    details: {
                        summary: 'Take steak out of fridge',
                        datetime: 'in 30 minutes'
                    }
                };
            }
        } else if (lowerCaseContent.includes('schedule') || lowerCaseContent.includes('create event')) {
            return {
                type: 'create_event',
                details: {
                    summary: 'New event',
                    description: 'Event details to be confirmed',
                    start: dayjs().add(1, 'hour').toISOString(),
                    duration: '1 hour'
                }
            };
        } else if (lowerCaseContent.includes('what') && lowerCaseContent.includes('schedule')) {
            return {
                type: 'query_schedule',
                details: {
                    date: dayjs().format('YYYY-MM-DD')
                }
            };
        }
    }

    console.log('Determined action:', null);
    return null;
}

function generateContext(previousMessages: Array<{ role: string, content: string }>): string {
    let contextInfo: ContextInfo = {
        topics: new Set(),
        timeReferences: new Set(),
        actions: new Set()
    };

    const relevantMessages = previousMessages.slice(-10); // Consider last 10 messages for context
    console.log('Relevant messages:', relevantMessages);

    for (const msg of relevantMessages) {
        const lowerContent = msg.content.toLowerCase();

        // Extract topics
        ['steak', 'fridge', 'cook', 'food', 'recipe', 'meal'].forEach(topic => {
            if (lowerContent.includes(topic)) contextInfo.topics.add(topic);
        });

        // Extract time references
        const timeMatches = lowerContent.match(/(\d+)\s*(minutes?|hours?|days?)/g);
        if (timeMatches) {
            timeMatches.forEach(match => contextInfo.timeReferences.add(match));
        }

        // Extract action-related words
        ['remind', 'schedule', 'set', 'create', 'plan'].forEach(action => {
            if (lowerContent.includes(action)) contextInfo.actions.add(action);
        });
    }

    let context = 'Context: ';
    if (contextInfo.topics.size > 0) {
        context += `Topics discussed: ${Array.from(contextInfo.topics).join(', ')}. `;
    }
    if (contextInfo.timeReferences.size > 0) {
        context += `Time references mentioned: ${Array.from(contextInfo.timeReferences).join(', ')}. `;
    }
    if (contextInfo.actions.size > 0) {
        context += `Actions considered: ${Array.from(contextInfo.actions).join(', ')}. `;
    }

    console.log('Generated context:', context);
    return context.trim();
}

async function performAction(action: { intent: string; details: any; }, previousMessages: Array<{ role: string, content: string }>) {
    console.log('Performing action:', JSON.stringify(action, null, 2));

    switch (action.intent) {
        case 'create_event':
            return await createEvent(action.details.suggestedAction);
        case 'query_schedule':
            return await querySchedule(action.details.suggestedAction?.date);
        case 'schedule_text_reminder':
            const lastUserMessage = previousMessages[previousMessages.length - 1];
            if (lastUserMessage && lastUserMessage.role === 'user' &&
                (lastUserMessage.content.toLowerCase().includes('yes') || lastUserMessage.content.toLowerCase().includes('please'))) {
                const result = await scheduleTextReminder(action.details.suggestedAction);
                return result;
            } else {
                return `${action.details.message} Would you like me to set this reminder for you?`;
            }
        case 'conversational':
            if (action.details.suggestedAction) {
                return `${action.details.message} Would you like me to set this reminder for you?`;
            }
            return action.details.message;
        default:
            console.log('Unknown action type:', action.intent);
            return `I'm not sure how to perform that action. Could you please provide more details or try rephrasing your request?`;
    }
}
