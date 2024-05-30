"use client";
import { useState } from 'react';

function Message() {
    const [to, setTo] = useState('');
    const [message, setMessage] = useState('');

    const sendMessage = async () => {
        const res = await fetch('/api/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ to, message }),
        });
        const data = await res.json();
        console.log(data);
    };

    return (
        <div>
            <input
                type="text"
                placeholder="To"
                value={to}
                onChange={(e) => setTo(e.target.value)}
            />
            <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
            />
            <button onClick={sendMessage}>Send</button>
        </div>
    );
}

export default Message;
