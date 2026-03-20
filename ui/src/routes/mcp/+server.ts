/**
 * Streamable HTTP MCP endpoint with SSE support
 * 
 * This endpoint implements the MCP Streamable HTTP transport as specified by Anthropic.
 * It supports:
 * - SSE (Server-Sent Events) for streaming responses
 * - Session management via MCP-Session-Id header
 * - Protocol version negotiation
 * - DELETE method for session teardown
 * 
 * Specification: https://spec.modelcontextprotocol.io/specification/basic/transports/#http-with-sse
 */

import { json, error as svelteError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// In-memory session storage (for development - use Redis/database in production)
const sessions = new Map<string, { created: Date; lastUsed: Date; data?: any }>();

// Clean up old sessions (older than 1 hour)
setInterval(() => {
	const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
	for (const [sessionId, session] of sessions.entries()) {
		if (session.lastUsed < oneHourAgo) {
			sessions.delete(sessionId);
			console.log(`[MCP SSE] Cleaned up expired session: ${sessionId}`);
		}
	}
}, 5 * 60 * 1000); // Check every 5 minutes

/**
 * POST - Handle MCP tool calls with SSE streaming
 */
export const POST: RequestHandler = async ({ request, fetch: eventFetch }) => {
	// Extract headers
	const sessionId = request.headers.get('MCP-Session-Id') || crypto.randomUUID();
	const protocolVersion = request.headers.get('MCP-Protocol-Version') || '2024-11-05';
	
	console.log('[MCP SSE] POST request received', { sessionId, protocolVersion });

	// Track or create session
	if (!sessions.has(sessionId)) {
		sessions.set(sessionId, {
			created: new Date(),
			lastUsed: new Date()
		});
		console.log('[MCP SSE] New session created:', sessionId);
	} else {
		const session = sessions.get(sessionId)!;
		session.lastUsed = new Date();
		console.log('[MCP SSE] Existing session accessed:', sessionId);
	}

	try {
		// Parse request body
		const body = await request.json();
		console.log('[MCP SSE] Request body:', body);

		// Forward to the existing /api/mcp handler
		const response = await eventFetch('/api/mcp', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'MCP-Session-Id': sessionId,
				'MCP-Protocol-Version': protocolVersion
			},
			body: JSON.stringify(body)
		});

		// Get the JSON response
		const data = await response.json();

		// For SSE transport, we need to check if client accepts text/event-stream
		const acceptHeader = request.headers.get('Accept') || '';
		const wantsSSE = acceptHeader.includes('text/event-stream');

		if (wantsSSE) {
			// Return SSE stream
			console.log('[MCP SSE] Client requested SSE stream');
			
			const stream = new ReadableStream({
				start(controller) {
					// Send the response as SSE event
					const message = `event: message\ndata: ${JSON.stringify(data)}\n\n`;
					controller.enqueue(new TextEncoder().encode(message));
					
					// End the stream
					const endMessage = `event: endpoint\ndata: {}\n\n`;
					controller.enqueue(new TextEncoder().encode(endMessage));
					controller.close();
				}
			});

			return new Response(stream, {
				headers: {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					'Connection': 'keep-alive',
					'MCP-Session-Id': sessionId,
					'MCP-Protocol-Version': protocolVersion,
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, MCP-Session-Id, MCP-Protocol-Version',
					'Access-Control-Expose-Headers': 'MCP-Session-Id, MCP-Protocol-Version'
				}
			});
		} else {
			// Return standard JSON response
			console.log('[MCP SSE] Client requested standard JSON');
			return json(data, {
				headers: {
					'MCP-Session-Id': sessionId,
					'MCP-Protocol-Version': protocolVersion,
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type, MCP-Session-Id, MCP-Protocol-Version',
					'Access-Control-Expose-Headers': 'MCP-Session-Id, MCP-Protocol-Version'
				}
			});
		}
	} catch (err) {
		console.error('[MCP SSE] Error handling request:', err);
		return json(
			{
				jsonrpc: '2.0',
				error: {
					code: -32603,
					message: err instanceof Error ? err.message : 'Internal error'
				},
				id: null
			},
			{
				status: 500,
				headers: {
					'MCP-Session-Id': sessionId,
					'MCP-Protocol-Version': protocolVersion,
					'Access-Control-Allow-Origin': '*'
				}
			}
		);
	}
};

/**
 * GET - Handle SSE endpoint information
 */
export const GET: RequestHandler = async ({ request }) => {
	const sessionId = request.headers.get('MCP-Session-Id');
	
	return json({
		endpoint: '/mcp',
		transport: 'streamable-http',
		protocol: '2024-11-05',
		features: ['sse', 'session-management'],
		session: sessionId ? {
			id: sessionId,
			active: sessions.has(sessionId)
		} : null
	}, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, MCP-Session-Id, MCP-Protocol-Version',
			'Access-Control-Expose-Headers': 'MCP-Session-Id, MCP-Protocol-Version'
		}
	});
};

/**
 * DELETE - Session teardown
 */
export const DELETE: RequestHandler = async ({ request }) => {
	const sessionId = request.headers.get('MCP-Session-Id');
	
	if (!sessionId) {
		throw svelteError(400, 'MCP-Session-Id header required for session teardown');
	}

	const existed = sessions.has(sessionId);
	sessions.delete(sessionId);
	
	console.log('[MCP SSE] Session deleted:', sessionId, { existed });

	return json({
		success: true,
		sessionId,
		deleted: existed
	}, {
		headers: {
			'MCP-Session-Id': sessionId,
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, MCP-Session-Id, MCP-Protocol-Version'
		}
	});
};

/**
 * OPTIONS - CORS preflight
 */
export const OPTIONS: RequestHandler = async () => {
	return new Response(null, {
		status: 204,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, MCP-Session-Id, MCP-Protocol-Version, Accept',
			'Access-Control-Expose-Headers': 'MCP-Session-Id, MCP-Protocol-Version',
			'Access-Control-Max-Age': '86400'
		}
	});
};
