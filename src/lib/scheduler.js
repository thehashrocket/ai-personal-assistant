import cron from 'node-cron';
import client from './twilio';

export function scheduleReminder(to, message, scheduleTime) {
    // Parse the scheduleTime to a cron format or use a Date object
    const date = new Date(scheduleTime);

    // Generate a cron expression for the given date
    const cronExpression = `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;

    // Schedule the job
    const job = cron.schedule(cronExpression, async () => {
        try {
            await client.messages.create({
                body: message,
                from: process.env.TWILIO_PHONE_NUMBER,
                to,
            });
            console.log(`Reminder sent to ${to}: ${message}`);
        } catch (error) {
            console.error('Error sending reminder:', error);
        }
        job.stop(); // Stop the job after it runs
    });

    job.start(); // Start the job

    return `Scheduled reminder for ${scheduleTime}`;
}
