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

type MCPDependencies = {
    git?: GitExtractor;
    formatter?: DiffFormatter;
    loadConfigFn?: typeof loadConfig;
    isLLMAvailableFn?: typeof isLLMAvailable;
    LLMClientCtor?: typeof LLMClient;
    systemPrompt?: string;
    createExplainPromptFn?: typeof createExplainPrompt;
    createReviewPromptFn?: typeof createReviewPrompt;
    createQuestionPromptFn?: typeof createQuestionPrompt;
};

export function createMCPHandlers(deps: MCPDependencies = {}) {
    const git = deps.git || new GitExtractor(process.cwd());
    const formatter = deps.formatter || new DiffFormatter();
    const loadConfigFn = deps.loadConfigFn || loadConfig;
    const isLLMAvailableFn = deps.isLLMAvailableFn || isLLMAvailable;
    const LLMClientCtor = deps.LLMClientCtor || LLMClient;
    const systemPrompt = deps.systemPrompt || SYSTEM_PROMPT;
    const createExplainPromptFn = deps.createExplainPromptFn || createExplainPrompt;
    const createReviewPromptFn = deps.createReviewPromptFn || createReviewPrompt;
    const createQuestionPromptFn = deps.createQuestionPromptFn || createQuestionPrompt;

    const listTools = async () => ({
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
    });

    const callTool = async (name: string, args: unknown) => {
        const typedArgs = args as Record<string, unknown> | undefined;
        switch (name) {
            case 'get_local_diff': {
                const diffs = await git.getLocalDiff({ staged: typedArgs?.staged as boolean | undefined });
                const format = (typedArgs?.format as string | undefined) || 'markdown';

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
                const diffs = await git.getCommitDiff(typedArgs?.commit1 as string, typedArgs?.commit2 as string | undefined);
                const format = (typedArgs?.format as string | undefined) || 'markdown';

                let content: string;
                switch (format) {
                    case 'json':
                        content = formatter.toJSON(diffs);
                        break;
                    case 'raw':
                        content = await git.getRawDiff('commit', {
                            commit1: typedArgs?.commit1 as string,
                            commit2: typedArgs?.commit2 as string | undefined,
                        });
                        break;
                    default:
                        content = formatter.toMarkdown(diffs);
                }

                return { content: [{ type: 'text', text: content }] };
            }

            case 'get_branch_diff': {
                const diffs = await git.getBranchDiff(typedArgs?.branch1 as string, typedArgs?.branch2 as string);
                const format = (typedArgs?.format as string | undefined) || 'markdown';

                let content: string;
                switch (format) {
                    case 'json':
                        content = formatter.toJSON(diffs);
                        break;
                    case 'raw':
                        content = await git.getRawDiff('branch', {
                            branch1: typedArgs?.branch1 as string,
                            branch2: typedArgs?.branch2 as string,
                        });
                        break;
                    default:
                        content = formatter.toMarkdown(diffs);
                }

                return { content: [{ type: 'text', text: content }] };
            }

            case 'get_commit_history': {
                const commits = await git.getCommitHistory((typedArgs?.limit as number | undefined) || 10);

                const content = commits.map(c =>
                    `- **${c.hash.slice(0, 7)}** (${new Date(c.date).toLocaleDateString()}): ${c.message.split('\n')[0]} — *${c.author}*`
                ).join('\n');

                return { content: [{ type: 'text', text: `# Recent Commits\n\n${content}` }] };
            }

            case 'explain_diff': {
                const config = loadConfigFn();
                const diffs = await git.getLocalDiff({ staged: typedArgs?.staged as boolean | undefined });

                if (diffs.length === 0) {
                    return { content: [{ type: 'text', text: 'No changes to explain.' }] };
                }

                if (!isLLMAvailableFn(config)) {
                    const prompt = createExplainPromptFn(diffs);
                    return {
                        content: [{
                            type: 'text',
                            text: `No LLM API key configured. Here's the diff for you to analyze:\n\n${prompt}`
                        }]
                    };
                }

                const llm = new LLMClientCtor(config);
                const response = await llm.chat([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: createExplainPromptFn(diffs) }
                ]);

                return { content: [{ type: 'text', text: response.content }] };
            }

            case 'review_diff': {
                const config = loadConfigFn();
                const diffs = await git.getLocalDiff({ staged: typedArgs?.staged as boolean | undefined });

                if (diffs.length === 0) {
                    return { content: [{ type: 'text', text: 'No changes to review.' }] };
                }

                if (!isLLMAvailableFn(config)) {
                    const prompt = createReviewPromptFn(diffs);
                    return {
                        content: [{
                            type: 'text',
                            text: `No LLM API key configured. Here's the diff for you to review:\n\n${prompt}`
                        }]
                    };
                }

                const llm = new LLMClientCtor(config);
                const response = await llm.chat([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: createReviewPromptFn(diffs) }
                ]);

                return { content: [{ type: 'text', text: response.content }] };
            }

            case 'ask_about_diff': {
                const config = loadConfigFn();
                const diffs = await git.getLocalDiff({ staged: typedArgs?.staged as boolean | undefined });

                if (diffs.length === 0) {
                    return { content: [{ type: 'text', text: 'No changes to ask about.' }] };
                }

                if (!isLLMAvailableFn(config)) {
                    const prompt = createQuestionPromptFn(diffs, typedArgs?.question as string);
                    return {
                        content: [{
                            type: 'text',
                            text: `No LLM API key configured. Here's the context for your question:\n\n${prompt}`
                        }]
                    };
                }

                const llm = new LLMClientCtor(config);
                const response = await llm.chat([
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: createQuestionPromptFn(diffs, typedArgs?.question as string) }
                ]);

                return { content: [{ type: 'text', text: response.content }] };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    };

    const listResources = async () => ({
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
    });

    const readResource = async (uri: string) => {
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
    };

    return { listTools, callTool, listResources, readResource };
}

export async function startMCPServer() {
    const handlers = createMCPHandlers();
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
    server.setRequestHandler(ListToolsRequestSchema, handlers.listTools);

    // Handle tool calls
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            return await handlers.callTool(name, args);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
        }
    });

    // Define resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        return handlers.listResources();
    });

    // Read resources
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        const { uri } = request.params;

        try {
            return await handlers.readResource(uri);
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
