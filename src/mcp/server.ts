import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GitExtractor, DiffFormatter } from '../git';
import { loadConfig, isLLMAvailable } from '../config';
import { LLMClient, SYSTEM_PROMPT, createExplainPrompt, createReviewPrompt, createQuestionPrompt } from '../llm';

const git = new GitExtractor(process.cwd());
const formatter = new DiffFormatter();

export async function startMCPServer() {
    const server = new Server(
        {
            name: 'difflearn',
            version: '0.1.0',
        },
        {
            capabilities: {
                tools: {},
                resources: {},
            },
        }
    );

    // Define available tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: 'get_local_diff',
                    description: 'Get uncommitted changes in the current git repository',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            staged: {
                                type: 'boolean',
                                description: 'If true, get only staged changes. Default: false',
                            },
                            format: {
                                type: 'string',
                                enum: ['markdown', 'json', 'raw'],
                                description: 'Output format. Default: markdown',
                            },
                        },
                    },
                },
                {
                    name: 'get_commit_diff',
                    description: 'Get the diff for a specific commit or between two commits',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            commit1: {
                                type: 'string',
                                description: 'First commit SHA (required)',
                            },
                            commit2: {
                                type: 'string',
                                description: 'Second commit SHA (optional, for range)',
                            },
                            format: {
                                type: 'string',
                                enum: ['markdown', 'json', 'raw'],
                                description: 'Output format. Default: markdown',
                            },
                        },
                        required: ['commit1'],
                    },
                },
                {
                    name: 'get_branch_diff',
                    description: 'Get the diff between two branches',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            branch1: {
                                type: 'string',
                                description: 'First branch name (required)',
                            },
                            branch2: {
                                type: 'string',
                                description: 'Second branch name (required)',
                            },
                            format: {
                                type: 'string',
                                enum: ['markdown', 'json', 'raw'],
                                description: 'Output format. Default: markdown',
                            },
                        },
                        required: ['branch1', 'branch2'],
                    },
                },
                {
                    name: 'get_commit_history',
                    description: 'Get a list of recent commits',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            limit: {
                                type: 'number',
                                description: 'Maximum number of commits to return. Default: 10',
                            },
                        },
                    },
                },
                {
                    name: 'explain_diff',
                    description: 'Get an AI explanation of the current changes. Requires LLM API key.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            staged: {
                                type: 'boolean',
                                description: 'If true, explain only staged changes',
                            },
                        },
                    },
                },
                {
                    name: 'review_diff',
                    description: 'Get an AI code review of the current changes. Requires LLM API key.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            staged: {
                                type: 'boolean',
                                description: 'If true, review only staged changes',
                            },
                        },
                    },
                },
                {
                    name: 'ask_about_diff',
                    description: 'Ask a question about the current changes.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            question: {
                                type: 'string',
                                description: 'Your question about the changes',
                            },
                            staged: {
                                type: 'boolean',
                                description: 'If true, consider only staged changes',
                            },
                        },
                        required: ['question'],
                    },
                },
            ],
        };
    });

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            switch (name) {
                case 'get_local_diff': {
                    const typedArgs = args as { staged?: boolean; format?: string };
                    const diffs = await git.getLocalDiff({ staged: typedArgs?.staged });
                    const format = typedArgs?.format || 'markdown';

                    let content: string;
                    switch (format) {
                        case 'json':
                            content = formatter.toJSON(diffs);
                            break;
                        case 'raw':
                            content = await git.getRawDiff(typedArgs?.staged ? 'staged' : 'local');
                            break;
                        default:
                            content = formatter.toMarkdown(diffs);
                    }

                    return { content: [{ type: 'text', text: content }] };
                }

                case 'get_commit_diff': {
                    const typedArgs = args as { commit1: string; commit2?: string; format?: string };
                    const diffs = await git.getCommitDiff(typedArgs.commit1, typedArgs.commit2);
                    const format = typedArgs?.format || 'markdown';

                    let content: string;
                    switch (format) {
                        case 'json':
                            content = formatter.toJSON(diffs);
                            break;
                        case 'raw':
                            content = await git.getRawDiff('commit', {
                                commit1: typedArgs.commit1,
                                commit2: typedArgs.commit2
                            });
                            break;
                        default:
                            content = formatter.toMarkdown(diffs);
                    }

                    return { content: [{ type: 'text', text: content }] };
                }

                case 'get_branch_diff': {
                    const typedArgs = args as { branch1: string; branch2: string; format?: string };
                    const diffs = await git.getBranchDiff(typedArgs.branch1, typedArgs.branch2);
                    const format = typedArgs?.format || 'markdown';

                    let content: string;
                    switch (format) {
                        case 'json':
                            content = formatter.toJSON(diffs);
                            break;
                        case 'raw':
                            content = await git.getRawDiff('branch', {
                                branch1: typedArgs.branch1,
                                branch2: typedArgs.branch2
                            });
                            break;
                        default:
                            content = formatter.toMarkdown(diffs);
                    }

                    return { content: [{ type: 'text', text: content }] };
                }

                case 'get_commit_history': {
                    const typedArgs = args as { limit?: number };
                    const commits = await git.getCommitHistory(typedArgs?.limit || 10);

                    const content = commits.map(c =>
                        `- **${c.hash.slice(0, 7)}** (${new Date(c.date).toLocaleDateString()}): ${c.message.split('\n')[0]} — *${c.author}*`
                    ).join('\n');

                    return { content: [{ type: 'text', text: `# Recent Commits\n\n${content}` }] };
                }

                case 'explain_diff': {
                    const typedArgs = args as { staged?: boolean };
                    const config = loadConfig();
                    const diffs = await git.getLocalDiff({ staged: typedArgs?.staged });

                    if (diffs.length === 0) {
                        return { content: [{ type: 'text', text: 'No changes to explain.' }] };
                    }

                    if (!isLLMAvailable(config)) {
                        const prompt = createExplainPrompt(diffs);
                        return {
                            content: [{
                                type: 'text',
                                text: `No LLM API key configured. Here's the diff for you to analyze:\n\n${prompt}`
                            }]
                        };
                    }

                    const llm = new LLMClient(config);
                    const response = await llm.chat([
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: createExplainPrompt(diffs) }
                    ]);

                    return { content: [{ type: 'text', text: response.content }] };
                }

                case 'review_diff': {
                    const typedArgs = args as { staged?: boolean };
                    const config = loadConfig();
                    const diffs = await git.getLocalDiff({ staged: typedArgs?.staged });

                    if (diffs.length === 0) {
                        return { content: [{ type: 'text', text: 'No changes to review.' }] };
                    }

                    if (!isLLMAvailable(config)) {
                        const prompt = createReviewPrompt(diffs);
                        return {
                            content: [{
                                type: 'text',
                                text: `No LLM API key configured. Here's the diff for you to review:\n\n${prompt}`
                            }]
                        };
                    }

                    const llm = new LLMClient(config);
                    const response = await llm.chat([
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: createReviewPrompt(diffs) }
                    ]);

                    return { content: [{ type: 'text', text: response.content }] };
                }

                case 'ask_about_diff': {
                    const typedArgs = args as { question: string; staged?: boolean };
                    const config = loadConfig();
                    const diffs = await git.getLocalDiff({ staged: typedArgs?.staged });

                    if (diffs.length === 0) {
                        return { content: [{ type: 'text', text: 'No changes to ask about.' }] };
                    }

                    if (!isLLMAvailable(config)) {
                        const prompt = createQuestionPrompt(diffs, typedArgs.question);
                        return {
                            content: [{
                                type: 'text',
                                text: `No LLM API key configured. Here's the context for your question:\n\n${prompt}`
                            }]
                        };
                    }

                    const llm = new LLMClient(config);
                    const response = await llm.chat([
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: createQuestionPrompt(diffs, typedArgs.question) }
                    ]);

                    return { content: [{ type: 'text', text: response.content }] };
                }

                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
        }
    });

    // Define resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return {
            resources: [
                {
                    uri: 'diff://local',
                    name: 'Local Changes',
                    description: 'Current uncommitted changes in the working directory',
                    mimeType: 'text/markdown',
                },
                {
                    uri: 'diff://staged',
                    name: 'Staged Changes',
                    description: 'Changes staged for commit',
                    mimeType: 'text/markdown',
                },
            ],
        };
    });

    // Read resources
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;

        try {
            if (uri === 'diff://local') {
                const diffs = await git.getLocalDiff();
                return {
                    contents: [{
                        uri,
                        mimeType: 'text/markdown',
                        text: formatter.toMarkdown(diffs),
                    }],
                };
            }

            if (uri === 'diff://staged') {
                const diffs = await git.getLocalDiff({ staged: true });
                return {
                    contents: [{
                        uri,
                        mimeType: 'text/markdown',
                        text: formatter.toMarkdown(diffs),
                    }],
                };
            }

            throw new Error(`Unknown resource: ${uri}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to read resource: ${message}`);
        }
    });

    // Start server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('DiffLearn MCP server running on stdio');
}

// Run if called directly
if (import.meta.main) {
    startMCPServer().catch(console.error);
}
