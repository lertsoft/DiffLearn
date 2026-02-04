import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { getLatestRelease, checkForUpdates } from '../src/update';

describe('Update fetch', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        globalThis.fetch = undefined as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test('getLatestRelease returns null on non-OK response', async () => {
        globalThis.fetch = (async () => ({
            ok: false,
            json: async () => ({}),
        })) as unknown as typeof fetch;

        const result = await getLatestRelease();
        expect(result).toBeNull();
    });

    test('getLatestRelease parses tag and metadata', async () => {
        globalThis.fetch = (async () => ({
            ok: true,
            json: async () => ({
                tag_name: 'v1.2.3',
                html_url: 'https://github.com/test/repo/releases/v1.2.3',
                body: 'Release notes',
                published_at: '2024-01-01T00:00:00Z',
            }),
        })) as unknown as typeof fetch;

        const result = await getLatestRelease();

        expect(result).not.toBeNull();
        expect(result?.version).toBe('1.2.3');
        expect(result?.url).toContain('releases');
        expect(result?.notes).toBe('Release notes');
        expect(result?.publishedAt).toBe('2024-01-01T00:00:00Z');
    });

    test('checkForUpdates flags update available', async () => {
        globalThis.fetch = (async () => ({
            ok: true,
            json: async () => ({
                tag_name: 'v9.9.9',
                html_url: 'https://github.com/test/repo/releases/v9.9.9',
            }),
        })) as unknown as typeof fetch;

        const result = await checkForUpdates();

        expect(result?.updateAvailable).toBe(true);
        expect(result?.latestVersion).toBe('9.9.9');
    });

    test('checkForUpdates returns no update when latest is older', async () => {
        globalThis.fetch = (async () => ({
            ok: true,
            json: async () => ({
                tag_name: 'v0.0.1',
                html_url: 'https://github.com/test/repo/releases/v0.0.1',
            }),
        })) as unknown as typeof fetch;
    
        const result = await checkForUpdates();

        expect(result?.updateAvailable).toBe(false);
        expect(result?.latestVersion).toBe('0.0.1');
    });
});
