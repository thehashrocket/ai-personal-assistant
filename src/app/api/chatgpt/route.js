import { NextResponse } from 'next/server';
import openai from '../../../lib/openai';
import calendar from '../../../lib/googleCalendar';
import client from '../../../lib/twilio';
import { scheduleReminder } from '../../../lib/scheduler';

async function handleOpenAIResponse(openAIResponse) {
    let parsedResponse;
    try {
        parsedResponse = JSON.parse(openAIResponse);
    } catch (error) {
        console.error('Error parsing OpenAI response:', error);
        return 'There was an error processing your request.';
    }

    const { intent, details } = parsedResponse || {};
    console.log('Parsed OpenAI response:', { intent, details });

    if (!intent) {
        console.log('Unknown intent:', intent);
        return 'I did not understand your request.';
    }

    switch (intent) {
        case 'create_event':
            return await createEvent(details);
        case 'send_reminder':
            return await sendReminder(details);
        case 'query_schedule':
            return await querySchedule(details.date);
        case 'schedule_text_reminder':
            return await scheduleTextReminder(details);
        case 'create_reminder':
            return await createReminder(details);
        default:
            console.log('Unknown intent:', intent);
            return 'I did not understand your request.';
    }
}

async function createEvent(details) {
    const { summary, description, start, end } = details;

    const event = {
        summary,
        description,
        start: {
            dateTime: start,
            timeZone: 'America/Los_Angeles',
        },
        end: {
            dateTime: end,
            timeZone: 'America/Los_Angeles',
        },
    };

    const response = await calendar.events.insert({
        calendarId: 'primary',
        resource: event,
    });

    return `Event created: ${summary} on ${start}`;
}

async function sendReminder(details) {
    const { to, event } = details;

    const response = await client.messages.create({
        body: `Reminder: ${event.summary} on ${event.start.dateTime}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to,
    });

    return `Reminder sent to ${to} for event: ${event.summary}`;
}

async function querySchedule(date) {
    const events = await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date(date).toISOString(),
        timeMax: new Date(new Date(date).setDate(new Date(date).getDate() + 1)).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
    });

    if (events.data.items.length === 0) {
        return `No events scheduled for ${date}`;
    }

    const eventList = events.data.items.map(event => {
        return `${event.summary} at ${event.start.dateTime}`;
    }).join('\n');

    return `Events for ${date}:\n${eventList}`;
}

function parseHumanReadableTime(humanTime, eventDate) {
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

async function scheduleTextReminder(details) {
    console.log('Scheduling text reminder with details:', details);

    const { summary, reminder_time, description } = details;
    const currentDateTime = new Date();
    const datetime = details.datetime || currentDateTime.toISOString(); // Default to current date if datetime is missing

    if (!summary || !reminder_time || !datetime) {
        console.error('Invalid details for scheduling reminder:', details);
        return 'Invalid details provided for scheduling reminder.';
    }

    try {
        console.log('Parsing datetime:', datetime);
        const eventDate = new Date(datetime);
        console.log('Parsed event date:', eventDate);

        let reminderDate;

        // Check if reminder_time is a valid date-time string
        if (!isNaN(Date.parse(reminder_time))) {
            reminderDate = new Date(reminder_time);
            // Ensure reminderDate is in the future
            if (reminderDate <= currentDateTime) {
                console.error('Reminder date is in the past:', reminderDate);
                return 'Cannot schedule reminder in the past.';
            }
        } else {
            console.log('Parsing reminder_time:', reminder_time);
            reminderDate = parseHumanReadableTime(reminder_time, currentDateTime);
            if (reminderDate <= currentDateTime) {
                console.error('Reminder date is in the past:', reminderDate);
                return 'Cannot schedule reminder in the past.';
            }
        }

        console.log('Parsed reminder date:', reminderDate);

        // Placeholder for phone number
        const to = "+1234567890"; // Replace this with actual logic to fetch or use the user's phone number
        const message = `Reminder: ${summary}`;
        console.log('Scheduling reminder:', { to, message, reminderDate });

        scheduleReminder(to, message, reminderDate);

        return `Scheduled reminder for ${summary} on ${reminderDate.toISOString()}`;
    } catch (error) {
        console.error('Error scheduling reminder:', error);
        return 'Error scheduling reminder.';
    }
}

async function createReminder(details) {
    console.log('Creating reminder with details:', details);

    const { title, date } = details;
    const currentDateTime = new Date();

    if (!title || !date) {
        console.error('Invalid details for creating reminder:', details);
        return 'Invalid details provided for creating reminder.';
    }

    try {
        const reminderDate = new Date(date);
        if (reminderDate <= currentDateTime) {
            console.error('Reminder date is in the past:', reminderDate);
            return 'Cannot create reminder in the past.';
        }

        // Placeholder for phone number
        const to = "+1234567890"; // Replace this with actual logic to fetch or use the user's phone number
        const message = `Reminder: ${title}`;
        console.log('Creating reminder:', { to, message, reminderDate });

        scheduleReminder(to, message, reminderDate);

        return `Created reminder for ${title} on ${reminderDate.toISOString()}`;
    } catch (error) {
        console.error('Error creating reminder:', error);
        return 'Error creating reminder.';
    }
}

export async function POST(req) {
    const { message } = await req.json();

    const openAIResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
            {
                role: 'system',
                content: `You are a virtual assistant. Interpret the following commands and provide a response in JSON format with the intent and details.

                Commands:
                1. Create an event: "Create an event titled 'Meeting' on June 5th at 10 AM for 1 hour."
                2. Send a reminder: "Send a reminder to +1234567890 for the 'Meeting' event."
                3. Query schedule: "What is on my schedule for June 5th?"
                4. Schedule text reminder: "Schedule a text reminder for the 'Meeting' event 10 minutes before."
                5. Create reminder: "Remind me to 'Call the doctor' on June 12th."

                Format:
                {
                    "intent": "create_event",
                    "details": {
                        "summary": "Meeting",
                        "description": "Discuss project",
                        "start": "2024-06-05T10:00:00-07:00",
                        "end": "2024-06-05T11:00:00-07:00"
                    }
                }

                Now, interpret the following command:
                `,
            },
            { role: 'user', content: message },
        ],
        max_tokens: 150,
    });

    if (openAIResponse.choices && openAIResponse.choices[0] && openAIResponse.choices[0].message && openAIResponse.choices[0].message.content) {
        console.log('OpenAI response:', openAIResponse.choices[0].message.content);
        const response = await handleOpenAIResponse(openAIResponse.choices[0].message.content);
        return NextResponse.json({ response });
    } else {
        console.error('Invalid OpenAI response:', openAIResponse);
        return NextResponse.json({ error: 'Please provide a valid command.' });
    }
}
