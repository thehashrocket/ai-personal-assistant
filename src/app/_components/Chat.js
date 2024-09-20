// ~/src/app/_components/Chat.js

"use client";
import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { api } from '~/trpc/react';

function Chat() {
    const [message, setMessage] = useState('');
    const [response, setResponse] = useState('');
    const [conversationId, setConversationId] = useState(null);
    const [chatHistory, setChatHistory] = useState([]);
    const [messages, setMessages] = useState([]);

    const [isGoogleCalendarAuthenticated, setIsGoogleCalendarAuthenticated] = useState(false);
    const [authError, setAuthError] = useState(null);

    const { data: tokenData, error: tokenError, isLoading: isTokenLoading } = api.token.getByUserAndProvider.useQuery(
        { provider: 'google' },
        {
            retry: false,
            refetchOnWindowFocus: false,
        }
    );

    const getGoogleAuthUrl = api.googleCalendar.getAuthUrl.useQuery();

    useEffect(() => {
        // Load chat history from local storage
        const storedHistory = localStorage.getItem('chatHistory');
        if (storedHistory) {
            setChatHistory(JSON.parse(storedHistory));
        }

        // Set conversation ID
        let storedConversationId = localStorage.getItem('conversationId');
        if (!storedConversationId) {
            storedConversationId = uuidv4();
            localStorage.setItem('conversationId', storedConversationId);
        }
        setConversationId(storedConversationId);

        // Handle Google Calendar authentication state
        if (!isTokenLoading) {
            if (tokenData) {
                setIsGoogleCalendarAuthenticated(true);
                setAuthError(null);
            } else if (tokenError) {
                console.error('Error checking Google Calendar auth:', tokenError);
                setIsGoogleCalendarAuthenticated(false);
                setAuthError(tokenError.message);
            } else {
                setIsGoogleCalendarAuthenticated(false);
                setAuthError(null);
            }
        }
    }, [tokenData, tokenError, isTokenLoading]);

    const handleGoogleCalendarAuth = async () => {
        if (!isGoogleCalendarAuthenticated && getGoogleAuthUrl.data) {
            window.location.href = getGoogleAuthUrl.data;
        }
    };


    const sendMessage = async () => {
        try {
            let storedConversationId = localStorage.getItem('conversationId');
            console.log('storedConversationId:', storedConversationId);

            const res = await fetch('/api/chatgpt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message, conversationId: storedConversationId }),
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Request failed: ${errorText}`);
            }

            const data = await res.json();
            setResponse(data.response);

            // Store the conversationId returned from the server
            if (data.conversationId) {
                localStorage.setItem('conversationId', data.conversationId);
                storedConversationId = data.conversationId;
            }

            // Update chat history
            const newChatHistory = [
                ...chatHistory,
                { role: 'user', content: message },
                { role: 'assistant', content: data.response }
            ];
            setChatHistory(newChatHistory);

            // Save chat history to local storage
            localStorage.setItem('chatHistory', JSON.stringify(newChatHistory));

            // Save conversationId along with each message
            const updatedChatHistoryWithIds = newChatHistory.map(msg => ({
                ...msg,
                conversationId: storedConversationId
            }));
            localStorage.setItem('chatHistoryWithIds', JSON.stringify(updatedChatHistoryWithIds));

            setMessage(''); // Clear input field after sending
        } catch (error) {
            console.error('Error sending message:', error);
            setResponse('An error occurred. Please try again.');
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-800 p-4">
            <div className="w-full max-w-lg p-4 bg-white dark:bg-gray-700 rounded-lg shadow-md text-gray-900 dark:text-gray-100">
                {isTokenLoading ? (
                    <p>Checking authentication status...</p>
                ) : !isGoogleCalendarAuthenticated ? (
                    <button
                        className="w-full py-2 mb-4 text-white bg-red-500 rounded-md hover:bg-red-600 focus:outline-none focus:ring focus:ring-red-300"
                        onClick={handleGoogleCalendarAuth}
                    >
                        Authenticate with Google Calendar
                    </button>
                ) : null}
                {authError && <p className="text-red-500 mb-4">{authError}</p>}

                <div className="mb-4 h-64 overflow-y-auto">
                    {chatHistory.map((chat, index) => (
                        <div key={index} className={`mb-2 ${chat.role === 'user' ? 'text-right' : 'text-left'}`}>
                            <span className={`inline-block p-2 rounded-lg ${chat.role === 'user'
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-200 dark:bg-gray-600 text-gray-900 dark:text-gray-100'
                                }`}>
                                {chat.content}
                            </span>
                        </div>
                    ))}
                </div>
                <textarea
                    className="w-full h-32 p-2 mb-4 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring focus:ring-blue-300 bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                    placeholder="Type your message here..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    style={{ colorScheme: 'light dark' }}
                />
                <button
                    className="w-full py-2 mb-4 text-white bg-blue-500 rounded-md hover:bg-blue-600 focus:outline-none focus:ring focus:ring-blue-300"
                    onClick={sendMessage}
                >
                    Send
                </button>
            </div>
        </div>
    );
}

export default Chat;