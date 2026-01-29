#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App, DiffMode } from './components/App';
import { GitExtractor, DiffFormatter } from '../git';
import { loadConfig, isLLMAvailable } from '../config';
import { LLMClient, SYSTEM_PROMPT, createExplainPrompt, createReviewPrompt, createSummaryPrompt } from '../llm';
import chalk from 'chalk';

const program = new Command();

program
    .name('difflearn')
    .description('Interactive git diff learning tool with LLM-powered explanations')
    .version('0.1.0');

// Interactive local diff viewer
program
    .command('local')
    .description('View local uncommitted changes interactively')
    .option('-s, --staged', 'View only staged changes')
    .option('--no-interactive', 'Print diff without interactive mode')
    .action(async (options) => {
        const mode: DiffMode = options.staged ? 'staged' : 'local';

        if (options.interactive === false) {
            // Non-interactive mode - just print the diff
            const git = new GitExtractor();
            const formatter = new DiffFormatter();
            const diffs = await git.getLocalDiff({ staged: options.staged });
            console.log(formatter.toTerminal(diffs));
            return;
        }

        render(<App mode={mode} />);
    });

// View commit diff
program
    .command('commit <sha>')
    .description('View changes in a specific commit')
    .option('-c, --compare <sha2>', 'Compare with another commit')
    .option('--no-interactive', 'Print diff without interactive mode')
    .action(async (sha, options) => {
        if (options.interactive === false) {
            const git = new GitExtractor();
            const formatter = new DiffFormatter();
            const diffs = await git.getCommitDiff(sha, options.compare);
            console.log(formatter.toTerminal(diffs));
            return;
        }

        render(<App mode="commit" commit1={sha} commit2={options.compare} />);
    });

// View branch diff
program
    .command('branch <branch1> <branch2>')
    .description('Compare two branches')
    .option('--no-interactive', 'Print diff without interactive mode')
    .action(async (branch1, branch2, options) => {
        if (options.interactive === false) {
            const git = new GitExtractor();
            const formatter = new DiffFormatter();
            const diffs = await git.getBranchDiff(branch1, branch2);
            console.log(formatter.toTerminal(diffs));
            return;
        }

        render(<App mode="branch" branch1={branch1} branch2={branch2} />);
    });

// Quick explain command (non-interactive)
program
    .command('explain')
    .description('Get an AI explanation of local changes')
    .option('-s, --staged', 'Explain only staged changes')
    .action(async (options) => {
        const config = loadConfig();

        if (!isLLMAvailable(config)) {
            console.log(chalk.yellow('⚠ No LLM API key configured.'));
            console.log(chalk.gray('Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_AI_API_KEY'));
            console.log(chalk.gray('\nGenerating prompt for external use:\n'));

            const git = new GitExtractor();
            const diffs = await git.getLocalDiff({ staged: options.staged });
            const prompt = createExplainPrompt(diffs);
            console.log(prompt);
            return;
        }

        console.log(chalk.cyan('🔍 Analyzing changes...\n'));

        const git = new GitExtractor();
        const diffs = await git.getLocalDiff({ staged: options.staged });

        if (diffs.length === 0) {
            console.log(chalk.yellow('No changes to explain.'));
            return;
        }

        const llm = new LLMClient(config);
        const prompt = createExplainPrompt(diffs);

        process.stdout.write(chalk.green('📝 Explanation:\n\n'));

        for await (const chunk of llm.streamChat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt }
        ])) {
            process.stdout.write(chunk);
        }
        console.log('\n');
    });

// Quick review command (non-interactive)
program
    .command('review')
    .description('Get an AI code review of local changes')
    .option('-s, --staged', 'Review only staged changes')
    .action(async (options) => {
        const config = loadConfig();

        if (!isLLMAvailable(config)) {
            console.log(chalk.yellow('⚠ No LLM API key configured.'));
            const git = new GitExtractor();
            const diffs = await git.getLocalDiff({ staged: options.staged });
            const prompt = createReviewPrompt(diffs);
            console.log(chalk.gray('\nGenerating prompt for external use:\n'));
            console.log(prompt);
            return;
        }

        console.log(chalk.cyan('🔍 Reviewing changes...\n'));

        const git = new GitExtractor();
        const diffs = await git.getLocalDiff({ staged: options.staged });

        if (diffs.length === 0) {
            console.log(chalk.yellow('No changes to review.'));
            return;
        }

        const llm = new LLMClient(config);
        const prompt = createReviewPrompt(diffs);

        process.stdout.write(chalk.green('📋 Code Review:\n\n'));

        for await (const chunk of llm.streamChat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt }
        ])) {
            process.stdout.write(chunk);
        }
        console.log('\n');
    });

// Quick summary command
program
    .command('summary')
    .description('Get a quick summary of changes')
    .option('-s, --staged', 'Summarize only staged changes')
    .action(async (options) => {
        const config = loadConfig();
        const git = new GitExtractor();
        const diffs = await git.getLocalDiff({ staged: options.staged });

        if (diffs.length === 0) {
            console.log(chalk.yellow('No changes to summarize.'));
            return;
        }

        if (!isLLMAvailable(config)) {
            // Just show file summary without LLM
            const formatter = new DiffFormatter();
            console.log(formatter.toSummary(diffs));
            return;
        }

        console.log(chalk.cyan('📊 Generating summary...\n'));

        const llm = new LLMClient(config);
        const prompt = createSummaryPrompt(diffs);

        for await (const chunk of llm.streamChat([
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: prompt }
        ])) {
            process.stdout.write(chunk);
        }
        console.log('\n');
    });

// Export for MCP/API
program
    .command('export')
    .description('Export diff in various formats')
    .option('-f, --format <format>', 'Output format: json, markdown, terminal', 'markdown')
    .option('-s, --staged', 'Export only staged changes')
    .action(async (options) => {
        const git = new GitExtractor();
        const formatter = new DiffFormatter();
        const diffs = await git.getLocalDiff({ staged: options.staged });

        switch (options.format) {
            case 'json':
                console.log(formatter.toJSON(diffs));
                break;
            case 'markdown':
                console.log(formatter.toMarkdown(diffs));
                break;
            case 'terminal':
            default:
                console.log(formatter.toTerminal(diffs));
        }
    });

// List recent commits
program
    .command('history')
    .description('List recent commits')
    .option('-n, --number <count>', 'Number of commits to show', '10')
    .action(async (options) => {
        const git = new GitExtractor();
        const commits = await git.getCommitHistory(parseInt(options.number, 10));

        for (const commit of commits) {
            console.log(chalk.yellow(commit.hash.slice(0, 7)) + ' ' +
                chalk.gray(new Date(commit.date).toLocaleDateString()) + ' ' +
                chalk.white(commit.message.split('\n')[0]) + ' ' +
                chalk.gray(`(${commit.author})`));
        }
    });

// Web UI - opens browser to local server
program
    .command('web')
    .description('Launch the web UI in your browser')
    .option('-p, --port <port>', 'Port for web server', '3000')
    .action(async (options) => {
        const port = parseInt(options.port, 10);
        console.log(chalk.cyan(`\n🔍 Starting DiffLearn Web UI...\n`));

        const { startAPIServer } = await import('../api/server');
        await startAPIServer(port);

        // Open browser
        const url = `http://localhost:${port}`;
        const openCmd = process.platform === 'darwin' ? 'open' :
            process.platform === 'win32' ? 'start' : 'xdg-open';

        Bun.spawn([openCmd, url]);
    });

// MCP server mode
program
    .command('serve')
    .description('Start as MCP, API, or Web UI server')
    .option('--mcp', 'Run as MCP server (for AI tools)')
    .option('--api', 'Run as REST API server (also serves web UI)')
    .option('-p, --port <port>', 'Port for API server', '3000')
    .action(async (options) => {
        if (options.mcp) {
            console.log(chalk.cyan('🔌 Starting MCP server...'));
            // Import and start MCP server
            const { startMCPServer } = await import('../mcp/server');
            await startMCPServer();
        } else if (options.api) {
            const { startAPIServer } = await import('../api/server');
            await startAPIServer(parseInt(options.port, 10));
        } else {
            console.log(chalk.yellow('Please specify --mcp or --api'));
            console.log(chalk.gray('  --mcp  Start MCP server for AI tool integration'));
            console.log(chalk.gray('  --api  Start REST API server (also serves web UI)'));
        }
    });

program.parse();
