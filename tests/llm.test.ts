
import { describe, test, expect, mock } from "bun:test";
import { EventEmitter } from "events";
import { LLMClient } from "../src/llm/client";
import { Config } from "../src/config";

// Mock Child Process Spawner
const mockSpawn = mock((_command, _args, _options) => {
    const proc: any = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = {
        write: mock(),
        end: mock(),
    };

    // Simulate async output
    setTimeout(() => {
        proc.stdout.emit('data', Buffer.from('Mock LLM Response'));
        proc.emit('close', 0);
    }, 10);

    return proc;
});

describe("LLMClient", () => {
    test("chatCLI with gemini-cli uses stdin", async () => {
        const config: Config = {
            provider: 'gemini-cli',
            useCLI: true,
            apiKey: 'test',
            model: 'test',
            spawner: mockSpawn, // Inject mock
        };

        const client = new LLMClient(config);
        mockSpawn.mockClear();

        const response = await client.chat([
            { role: 'user', content: 'Hello AI' }
        ]);

        expect(response.content).toBe('Mock LLM Response');
        expect(mockSpawn).toHaveBeenCalled();
        const call = mockSpawn.mock.calls[0];
        expect(call[0]).toBe('gemini'); // Command

        // Verify stdin was written to
        // We need to capture the proc object returned.
        const proc = mockSpawn.mock.results[0].value;
        expect(proc.stdin.write).toHaveBeenCalled();
        expect(proc.stdin.write.mock.calls[0][0]).toContain('User: Hello AI');
        expect(proc.stdin.end).toHaveBeenCalled();
    });

    test("chatCLI with claude-code uses args for prompt", async () => {
        const config: Config = {
            provider: 'claude-code',
            useCLI: true,
            apiKey: 'test',
            model: 'test',
            spawner: mockSpawn,
        };

        const client = new LLMClient(config);
        mockSpawn.mockClear();

        await client.chat([{ role: 'user', content: 'Hi Claude' }]);

        expect(mockSpawn).toHaveBeenCalled();
        const call = mockSpawn.mock.calls[0];
        expect(call[0]).toBe('claude');
        expect(call[1]).toContain('-p');
        expect(call[1].join(' ')).toContain('User: Hi Claude');
    });

    test("handles CLI errors", async () => {
        // Setup mock to fail
        const errorMockSpawn = mock(() => {
            const proc: any = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: mock(), end: mock() };
            setTimeout(() => {
                proc.stderr.emit('data', 'Error message');
                proc.emit('close', 1);
            }, 10);
            return proc;
        });

        const config: Config = {
            provider: 'gemini-cli',
            useCLI: true,
            apiKey: '',
            model: '',
            spawner: errorMockSpawn
        };
        const client = new LLMClient(config);

        try {
            await client.chat([{ role: 'user', content: 'fail' }]);
            expect(true).toBe(false); // Should not reach here
        } catch (e: any) {
            expect(e.message).toContain('failed (code 1)');
        }
    });

    test("chatCLI with codex uses stdin", async () => {
        const config: Config = {
            provider: 'codex',
            useCLI: true,
            apiKey: '',
            model: '',
            spawner: mockSpawn
        };
        const client = new LLMClient(config);
        mockSpawn.mockClear();

        await client.chat([{ role: 'user', content: 'codex input' }]);

        expect(mockSpawn).toHaveBeenCalled();
        const call = mockSpawn.mock.calls[0];
        expect(call[0]).toBe('codex');
        expect(call[1]).toEqual(['exec', '-']);
        const proc = mockSpawn.mock.results[0].value;
        expect(proc.stdin.write).toHaveBeenCalled();
        expect(proc.stdin.write.mock.calls[0][0]).toContain('User: codex input');
        expect(proc.stdin.end).toHaveBeenCalled();
    });

    test("CLI auth failures include a provider-specific auth hint", async () => {
        const authErrorSpawn = mock(() => {
            const proc: any = new EventEmitter();
            proc.stdout = new EventEmitter();
            proc.stderr = new EventEmitter();
            proc.stdin = { write: mock(), end: mock() };
            setTimeout(() => {
                proc.stderr.emit('data', 'Not logged in. Please login first.');
                proc.emit('close', 1);
            }, 10);
            return proc;
        });

        const config: Config = {
            provider: 'codex',
            useCLI: true,
            apiKey: '',
            model: '',
            spawner: authErrorSpawn
        };
        const client = new LLMClient(config);

        await expect(client.chat([{ role: 'user', content: 'auth test' }]))
            .rejects
            .toThrow('Try authenticating first: codex login');
    });
});
