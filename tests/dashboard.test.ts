/**
 * Tests for the UnifiedDashboard slash command filtering logic
 */
import { describe, test, expect } from 'bun:test';

// Recreate the slash command types and filtering logic for testing
interface SlashCommand {
    cmd: string;
    desc: string;
    requiresChanges?: boolean;
    requiresCommit?: boolean;
    globalOnly?: boolean;
}

const SLASH_COMMANDS: SlashCommand[] = [
    // AI commands - require changes to analyze
    { cmd: '/explain', desc: 'Get a detailed explanation of the changes', requiresChanges: true },
    { cmd: '/review', desc: 'Get a code review with suggestions', requiresChanges: true },
    { cmd: '/summarize', desc: 'Get a quick summary of changes', requiresChanges: true },

    // Export/utility commands
    { cmd: '/export', desc: 'Export diff as markdown/json', requiresChanges: true },
    { cmd: '/history', desc: 'Show more commit history', globalOnly: true },

    // Navigation commands
    { cmd: '/local', desc: 'View local (unstaged) changes', globalOnly: true },
    { cmd: '/staged', desc: 'View staged changes', globalOnly: true },
    { cmd: '/web', desc: 'Open web UI in browser', globalOnly: true },
    { cmd: '/config', desc: 'Show LLM configuration status', globalOnly: true },

    // Commands that work on commits
    { cmd: '/compare', desc: 'Compare with another commit', requiresCommit: true },
];

// Recreate the filtering logic
function getMatchingCommands(
    chatInput: string,
    hasChanges: boolean,
    isViewingCommit: boolean
): SlashCommand[] {
    if (!chatInput.startsWith('/')) return [];

    return SLASH_COMMANDS.filter(c => {
        // First check if command matches input
        if (!c.cmd.startsWith(chatInput) && chatInput !== '/') return false;

        // Check context requirements
        if (c.requiresChanges && !hasChanges) return false;
        if (c.requiresCommit && !isViewingCommit) return false;
        if (c.globalOnly && isViewingCommit) return false;

        return true;
    });
}

describe('Slash Commands', () => {
    describe('context filtering', () => {
        test('should hide AI commands when no changes are available', () => {
            const commands = getMatchingCommands('/', false, false);

            const aiCommands = commands.filter(c =>
                c.cmd === '/explain' || c.cmd === '/review' || c.cmd === '/summarize'
            );

            expect(aiCommands.length).toBe(0);
        });

        test('should show AI commands when local/staged changes exist', () => {
            const commands = getMatchingCommands('/', true, false);

            expect(commands.some(c => c.cmd === '/explain')).toBe(true);
            expect(commands.some(c => c.cmd === '/review')).toBe(true);
            expect(commands.some(c => c.cmd === '/summarize')).toBe(true);
        });

        test('should show AI commands when viewing a commit', () => {
            const commands = getMatchingCommands('/', true, true);

            expect(commands.some(c => c.cmd === '/explain')).toBe(true);
            expect(commands.some(c => c.cmd === '/review')).toBe(true);
        });

        test('should hide global-only commands when viewing a commit', () => {
            const commands = getMatchingCommands('/', true, true);

            expect(commands.some(c => c.cmd === '/history')).toBe(false);
            expect(commands.some(c => c.cmd === '/local')).toBe(false);
            expect(commands.some(c => c.cmd === '/staged')).toBe(false);
            expect(commands.some(c => c.cmd === '/web')).toBe(false);
            expect(commands.some(c => c.cmd === '/config')).toBe(false);
        });

        test('should show global-only commands on main dashboard', () => {
            const commands = getMatchingCommands('/', false, false);

            expect(commands.some(c => c.cmd === '/history')).toBe(true);
            expect(commands.some(c => c.cmd === '/local')).toBe(true);
            expect(commands.some(c => c.cmd === '/staged')).toBe(true);
            expect(commands.some(c => c.cmd === '/web')).toBe(true);
            expect(commands.some(c => c.cmd === '/config')).toBe(true);
        });

        test('should show /compare only when viewing a commit', () => {
            const mainDashboard = getMatchingCommands('/', true, false);
            const commitView = getMatchingCommands('/', true, true);

            expect(mainDashboard.some(c => c.cmd === '/compare')).toBe(false);
            expect(commitView.some(c => c.cmd === '/compare')).toBe(true);
        });

        test('should filter /export based on changes availability', () => {
            const noChanges = getMatchingCommands('/', false, false);
            const withChanges = getMatchingCommands('/', true, false);

            expect(noChanges.some(c => c.cmd === '/export')).toBe(false);
            expect(withChanges.some(c => c.cmd === '/export')).toBe(true);
        });
    });

    describe('partial matching', () => {
        test('should filter by partial command input', () => {
            const commands = getMatchingCommands('/e', true, false);

            expect(commands.length).toBe(2); // /explain and /export
            expect(commands.some(c => c.cmd === '/explain')).toBe(true);
            expect(commands.some(c => c.cmd === '/export')).toBe(true);
        });

        test('should match single command with partial input', () => {
            const commands = getMatchingCommands('/rev', true, false);

            expect(commands.length).toBe(1);
            expect(commands[0].cmd).toBe('/review');
        });

        test('should return empty for non-matching input', () => {
            const commands = getMatchingCommands('/xyz', true, false);

            expect(commands.length).toBe(0);
        });

        test('should not match if context requirements not met', () => {
            // /explain requires changes
            const commands = getMatchingCommands('/exp', false, false);

            expect(commands.length).toBe(0);
        });
    });

    describe('empty state handling', () => {
        test('should return only navigation commands when no changes and no commit', () => {
            const commands = getMatchingCommands('/', false, false);

            // Should have navigation commands but not AI or export commands
            expect(commands.some(c => c.cmd === '/local')).toBe(true);
            expect(commands.some(c => c.cmd === '/explain')).toBe(false);
            expect(commands.some(c => c.cmd === '/export')).toBe(false);
        });
    });
});
