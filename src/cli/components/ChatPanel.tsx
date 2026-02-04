import React, { useState } from 'react';
import { Box, Text, useInput, useFocus } from 'ink';
import TextInput from 'ink-text-input';
import { ParsedDiff } from '../../git';
import { LLMClient, ChatMessage, SYSTEM_PROMPT, createLineQuestionPrompt, createReviewPrompt, createSummaryPrompt, createExplainPrompt } from '../../llm';

interface ChatPanelProps {
    diff: ParsedDiff;
    hunkIndex: number;
    llmClient?: LLMClient;
    onClose: () => void;
}

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    diff,
    hunkIndex,
    llmClient,
    onClose
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [scrollOffset, setScrollOffset] = useState(0);
    const { isFocused } = useFocus({ autoFocus: true });

    const hunk = diff.hunks[hunkIndex];
    useInput((inputKey, key) => {
        if (!isFocused) return;

        // Close on Escape
        if (key.escape) {
            onClose();
            return;
        }

        // Scroll messages
        if (key.upArrow && key.shift) {
            setScrollOffset(prev => Math.max(0, prev - 1));
        } else if (key.downArrow && key.shift) {
            setScrollOffset(prev => prev + 1);
        }
    });

    const handleSubmit = async (query: string) => {
        if (!query.trim() || isLoading) return;

        const userMessage: Message = { role: 'user', content: query };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);
        setError(null);

        if (!llmClient) {
            // No LLM configured - provide formatted output for external tools
            const formattedQuestion = createLineQuestionPrompt(diff, hunkIndex, query);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `📋 No LLM configured. Here's the formatted prompt you can use with your preferred AI tool:\n\n---\n${formattedQuestion}\n---\n\nSet OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY to enable built-in AI responses.`
            }]);
            setIsLoading(false);
            return;
        }

        try {
            // Determine prompt based on input
            let prompt = '';
            if (query === '/explain') {
                prompt = createExplainPrompt([diff]); // Analyze the whole file diff
            } else if (query === '/review') {
                prompt = createReviewPrompt([diff]);
            } else if (query === '/summarize') {
                prompt = createSummaryPrompt([diff]);
            } else {
                prompt = createLineQuestionPrompt(diff, hunkIndex, query);
            }

            // Build conversation history for LLM
            const chatHistory: ChatMessage[] = [
                { role: 'system', content: SYSTEM_PROMPT },
                ...messages.map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: prompt }
            ];

            // Stream the response
            let fullResponse = '';
            setMessages(prev => [...prev, { role: 'assistant', content: '...' }]);

            for await (const chunk of llmClient.streamChat(chatHistory)) {
                fullResponse += chunk;
                setMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'assistant', content: fullResponse };
                    return newMessages;
                });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
            setMessages(prev => prev.slice(0, -1)); // Remove the placeholder
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Box
            flexDirection="column"
            borderStyle="double"
            borderColor="cyan"
            padding={1}
            width="100%"
            minHeight={15}
        >
            {/* Header */}
            <Box marginBottom={1} justifyContent="space-between">
                <Box>
                    <Text color="cyan" bold>💬 Ask about: </Text>
                    <Text color="white">{diff.newFile}</Text>
                    <Text color="gray"> (hunk {hunkIndex + 1})</Text>
                </Box>
                <Text color="gray" dimColor>ESC to close • Shift+↑↓ to scroll</Text>
            </Box>

            {/* Hunk preview */}
            <Box flexDirection="column" marginBottom={1} paddingX={1}>
                <Text color="gray" dimColor>Context:</Text>
                {hunk && hunk.lines.slice(0, 3).map((line, i) => {
                    const color = line.type === 'add' ? 'green' : line.type === 'delete' ? 'red' : 'gray';
                    const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
                    return (
                        <Text key={i} color={color} dimColor>
                            {prefix}{line.content.slice(0, 60)}{line.content.length > 60 ? '...' : ''}
                        </Text>
                    );
                })}
                {hunk && hunk.lines.length > 3 && (
                    <Text color="gray" dimColor>  ... +{hunk.lines.length - 3} more lines</Text>
                )}
            </Box>

            {/* Messages area - scrollable */}
            <Box
                flexDirection="column"
                flexGrow={1}
                overflowY="hidden"
                marginBottom={1}
            >
                {messages.length === 0 ? (
                    <Text color="gray" italic>
                        Ask a question about this change. Examples:
                        {'\n'}• "What does this change do?"
                        {'\n'}• "Is there a bug here?"
                        {'\n'}• "Why was this approach chosen?"
                    </Text>
                ) : (
                    messages.slice(scrollOffset).map((msg, i) => (
                        <Box key={i} flexDirection="column" marginBottom={1}>
                            <Text color={msg.role === 'user' ? 'blue' : 'green'} bold>
                                {msg.role === 'user' ? '👤 You' : '🤖 DiffLearn'}:
                            </Text>
                            <Box paddingLeft={2}>
                                <Text wrap="wrap">{msg.content}</Text>
                            </Box>
                        </Box>
                    ))
                )}
                {isLoading && (
                    <Text color="yellow">⏳ Thinking...</Text>
                )}
                {error && (
                    <Text color="red">❌ Error: {error}</Text>
                )}
            </Box>

            {/* Input area */}
            <Box borderStyle="single" borderColor="gray" paddingX={1}>
                <Text color="cyan">❯ </Text>
                <TextInput
                    value={input}
                    onChange={setInput}
                    onSubmit={handleSubmit}
                    placeholder="Type a question or use /explain, /review, /summarize..."
                />
            </Box>
            {input.startsWith('/') && (
                <Box marginLeft={2} marginBottom={0}>
                    <Text color="gray" dimColor>
                        Suggestions:
                        <Text color={input === '/explain' ? 'cyan' : 'gray'}> /explain</Text>
                        <Text color={input === '/review' ? 'cyan' : 'gray'}> /review</Text>
                        <Text color={input === '/summarize' ? 'cyan' : 'gray'}> /summarize</Text>
                    </Text>
                </Box>
            )}
        </Box>
    );
};

export default ChatPanel;
