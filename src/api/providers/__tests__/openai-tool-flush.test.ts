/**
 * Tests for OpenAI provider tool call accumulator flush fix.
 *
 * Verifies that tool calls streamed via delta.tool_calls are correctly
 * yielded even when the provider returns finish_reason 'stop' instead
 * of 'tool_calls' (common with OpenRouter proxied models like gpt-oss-120b).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiStreamChunk } from '../../types';

// ---------------------------------------------------------------------------
// We test the streaming logic by importing and instantiating OpenAiProvider
// with a mocked OpenAI client.
// ---------------------------------------------------------------------------

// Mock openai module — we only need client.chat.completions.create to return
// an async iterator of SSE-like chunks.
vi.mock('openai', () => {
    class MockOpenAI {
        chat = {
            completions: {
                create: vi.fn(),
            },
        };

        constructor(_opts: Record<string, unknown>) {
            // Store for test access
            (MockOpenAI as unknown as Record<string, unknown>).__lastInstance = this;
        }
    }

    return { default: MockOpenAI };
});

// Helper: build a minimal SSE chunk in the shape of OpenAI streaming response
function chunk(
    delta: Record<string, unknown>,
    finishReason: string | null = null,
    usage?: { prompt_tokens: number; completion_tokens: number },
): Record<string, unknown> {
    return {
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        ...(usage ? { usage } : {}),
    };
}

// Helper: create an async iterable from an array (simulates SSE stream)
async function* asyncIter<T>(items: T[]): AsyncIterable<T> {
    for (const item of items) yield item;
}

// Dynamic import so mock takes effect
async function createProvider() {
    const { OpenAiProvider } = await import('../openai');
    return new OpenAiProvider({
        type: 'openrouter',
        provider: 'openrouter',
        model: 'openai/gpt-oss-120b',
        apiKey: 'sk-test',
    } as never);
}

async function collectStream(stream: AsyncIterable<ApiStreamChunk>): Promise<ApiStreamChunk[]> {
    const chunks: ApiStreamChunk[] = [];
    for await (const c of stream) chunks.push(c);
    return chunks;
}

describe('OpenAI provider tool call flush', () => {
    let provider: Awaited<ReturnType<typeof createProvider>>;

    beforeEach(async () => {
        vi.clearAllMocks();
        provider = await createProvider();
    });

    it('yields tool_use when finish_reason is "tool_calls" (normal path)', async () => {
        const mockCreate = (provider as unknown as Record<string, Record<string, Record<string, ReturnType<typeof vi.fn>>>>)
            .client.chat.completions.create;

        mockCreate.mockReturnValue(asyncIter([
            // Tool call streamed in two deltas
            chunk({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pat' } }] }),
            chunk({ tool_calls: [{ index: 0, function: { arguments: 'h":"test.md"}' } }] }),
            // Correct finish_reason
            chunk({}, 'tool_calls'),
        ]));

        const results = await collectStream(
            provider.createMessage('system', [], [{ name: 'read_file', description: 'Read a file', inputSchema: {} }]),
        );

        const toolUse = results.find(r => r.type === 'tool_use');
        expect(toolUse).toBeDefined();
        expect(toolUse).toMatchObject({
            type: 'tool_use',
            id: 'call_1',
            name: 'read_file',
            input: { path: 'test.md' },
        });
    });

    it('yields tool_use when finish_reason is "stop" (flush fix)', async () => {
        const mockCreate = (provider as unknown as Record<string, Record<string, Record<string, ReturnType<typeof vi.fn>>>>)
            .client.chat.completions.create;

        mockCreate.mockReturnValue(asyncIter([
            // Text + tool call deltas
            chunk({ content: 'Let me read that file.' }),
            chunk({ tool_calls: [{ index: 0, id: 'call_2', function: { name: 'read_file', arguments: '{"path":"notes.md"}' } }] }),
            // BUG: provider returns 'stop' instead of 'tool_calls'
            chunk({}, 'stop'),
        ]));

        const results = await collectStream(
            provider.createMessage('system', [], [{ name: 'read_file', description: 'Read a file', inputSchema: {} }]),
        );

        const toolUse = results.find(r => r.type === 'tool_use');
        expect(toolUse).toBeDefined();
        expect(toolUse).toMatchObject({
            type: 'tool_use',
            id: 'call_2',
            name: 'read_file',
            input: { path: 'notes.md' },
        });

        // Text should also be present
        const text = results.filter(r => r.type === 'text').map(r => (r as { text: string }).text).join('');
        expect(text).toBe('Let me read that file.');
    });

    it('yields tool_use when finish_reason is null (no finish signal)', async () => {
        const mockCreate = (provider as unknown as Record<string, Record<string, Record<string, ReturnType<typeof vi.fn>>>>)
            .client.chat.completions.create;

        mockCreate.mockReturnValue(asyncIter([
            chunk({ tool_calls: [{ index: 0, id: 'call_3', function: { name: 'web_search', arguments: '{"query":"test"}' } }] }),
            // Stream ends without any finish_reason
            chunk({}, null),
        ]));

        const results = await collectStream(
            provider.createMessage('system', [], [{ name: 'web_search', description: 'Search', inputSchema: {} }]),
        );

        const toolUse = results.find(r => r.type === 'tool_use');
        expect(toolUse).toBeDefined();
        expect(toolUse).toMatchObject({
            type: 'tool_use',
            name: 'web_search',
            input: { query: 'test' },
        });
    });

    it('yields multiple tool_use chunks when flushed (parallel tool calls)', async () => {
        const mockCreate = (provider as unknown as Record<string, Record<string, Record<string, ReturnType<typeof vi.fn>>>>)
            .client.chat.completions.create;

        mockCreate.mockReturnValue(asyncIter([
            chunk({
                tool_calls: [
                    { index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"path":"a.md"}' } },
                    { index: 1, id: 'call_b', function: { name: 'read_file', arguments: '{"path":"b.md"}' } },
                ],
            }),
            chunk({}, 'stop'),
        ]));

        const results = await collectStream(
            provider.createMessage('system', [], [{ name: 'read_file', description: 'Read a file', inputSchema: {} }]),
        );

        const toolUses = results.filter(r => r.type === 'tool_use');
        expect(toolUses).toHaveLength(2);
        expect(toolUses[0]).toMatchObject({ name: 'read_file', input: { path: 'a.md' } });
        expect(toolUses[1]).toMatchObject({ name: 'read_file', input: { path: 'b.md' } });
    });

    it('does not double-yield when finish_reason is "tool_calls" (already flushed)', async () => {
        const mockCreate = (provider as unknown as Record<string, Record<string, Record<string, ReturnType<typeof vi.fn>>>>)
            .client.chat.completions.create;

        mockCreate.mockReturnValue(asyncIter([
            chunk({ tool_calls: [{ index: 0, id: 'call_x', function: { name: 'read_file', arguments: '{"path":"x.md"}' } }] }),
            // Correct finish_reason — tool calls are yielded and map is cleared
            chunk({}, 'tool_calls'),
        ]));

        const results = await collectStream(
            provider.createMessage('system', [], [{ name: 'read_file', description: 'Read a file', inputSchema: {} }]),
        );

        const toolUses = results.filter(r => r.type === 'tool_use');
        // Should yield exactly once, not twice
        expect(toolUses).toHaveLength(1);
    });
});
