import type { JsonSchema } from '../mcp/client';

export type Field = {
	key: string;
	label: string;
	kind: 'select' | 'switch' | 'number' | 'text';
	required: boolean;
	options?: string[];
	min?: number;
	max?: number;
	default?: unknown;
	description?: string;
};

type Prop = {
	type?: string | string[];
	enum?: unknown[];
	minimum?: number;
	maximum?: number;
	default?: unknown;
	description?: string;
	anyOf?: Prop[];
};

function labelFor(key: string): string {
	const words = key.replace(/_/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function typeOf(p: Prop): string | undefined {
	if (Array.isArray(p.type)) return p.type.find((t) => t !== 'null');
	if (p.type) return p.type;
	return p.anyOf?.map(typeOf).find((t) => t && t !== 'null');
}

/** Turn a tool's JSON Schema into form fields: required first, then schema order. */
export function fieldsFromSchema(schema: JsonSchema): Field[] {
	const props = (schema.properties ?? {}) as Record<string, Prop>;
	const required = new Set((schema.required as string[] | undefined) ?? []);
	const fields = Object.entries(props).map(([key, p]): Field => {
		const base = {
			key,
			label: labelFor(key),
			required: required.has(key),
			default: p.default,
			description: p.description
		};
		if (Array.isArray(p.enum)) return { ...base, kind: 'select', options: p.enum.map(String) };
		const t = typeOf(p);
		if (t === 'boolean') return { ...base, kind: 'switch' };
		if (t === 'integer' || t === 'number') {
			return { ...base, kind: 'number', min: p.minimum, max: p.maximum };
		}
		return { ...base, kind: 'text' };
	});
	return [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)];
}

/** Values from the form to tool arguments: empty optional values are left out. */
export function argsFromValues(
	fields: Field[],
	values: Record<string, unknown>
): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	for (const f of fields) {
		const v = values[f.key];
		if (v === undefined || v === null || v === '') continue;
		if (f.kind === 'number') {
			const n = Number(v);
			if (Number.isFinite(n)) args[f.key] = n;
		} else {
			args[f.key] = v;
		}
	}
	return args;
}
