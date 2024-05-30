"use client";
import { useState } from 'react';

function Calendar() {
    const [summary, setSummary] = useState('');
    const [description, setDescription] = useState('');
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');

    const addEvent = async () => {
        const res = await fetch('/api/calendar', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ summary, description, start, end }),
        });
        const data = await res.json();
        console.log(data);
    };

    return (
        <div>
            <input
                type="text"
                placeholder="Summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
            />
            <textarea
                placeholder="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
            />
            <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
            />
            <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
            />
            <button onClick={addEvent}>Add Event</button>
        </div>
    );
}

export default Calendar;
