"use client";
import { useState } from 'react';

function Chat() {
    const [message, setMessage] = useState('');
    const [response, setResponse] = useState('');

    const sendMessage = async () => {
        try {
            const res = await fetch('/api/chatgpt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Request failed: ${errorText}`);
            }

            const data = await res.json();
            setResponse(data.response);
        } catch (error) {
            console.error('Error sending message:', error);
            setResponse('An error occurred. Please try again.');
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
            <div className="w-full max-w-lg p-4 bg-white rounded-lg shadow-md text-gray-900">
                <textarea
                    className="w-full h-32 p-2 mb-4 border border-gray-300 rounded-md focus:outline-none focus:ring focus:ring-blue-300 text-black-900 placeholder-gray-500"
                    placeholder="Type your message here..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                />
                <button
                    className="w-full py-2 mb-4 text-white bg-blue-500 rounded-md hover:bg-blue-600 focus:outline-none focus:ring focus:ring-blue-300"
                    onClick={sendMessage}
                >
                    Send
                </button>
                <div className="p-4 bg-gray-100 rounded-md">
                    <p className="text-gray-700 whitespace-pre-wrap">{response}</p>
                </div>
            </div>
        </div>
    );
}

export default Chat;
