/**
 * Generates a compact, unique request-ID string.
 * Format: "<timestamp-hex>-<4-byte-random-hex>"
 * Example: "19570c4a3b0-a3f2b891"
 */
export function generateRequestId(): string {
	return `${Date.now().toString(16)}-${Math.floor(Math.random() * 0xffffffff)
		.toString(16)
		.padStart(8, '0')}`;
}
