import { NextResponse } from 'next/server';
import client from '../../../lib/twilio';

export async function POST(req) {
    const { to, message } = await req.json();

    const response = await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to,
    });

    return NextResponse.json({ response });
}
