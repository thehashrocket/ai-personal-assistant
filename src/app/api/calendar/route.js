import { NextResponse } from 'next/server';
import calendar from '../../../lib/googleCalendar';

export async function POST(req) {
    const { summary, description, start, end } = await req.json();

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

    try {
        const response = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });

        return NextResponse.json({ response });
    } catch (error) {
        return NextResponse.error(error.message);
    }
}
