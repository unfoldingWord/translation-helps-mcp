/**
 * Standard Response Shapes
 *
 * Consistent response formats across all endpoints.
 * Every endpoint returns data in predictable shapes!
 */

/**
 * Standard metadata that all responses should include
 */
export interface StandardMetadata {
	/** Total count of items returned */
	totalCount?: number;
	/** Source of the data */
	source?: string;
	/** Language of the content */
	language?: string;
	/** Organization providing the content */
	organization?: string;
	/** Resources included */
	resources?: string[];
	/** License information */
	license?: string;
	/** Copyright information */
	copyright?: string;
	/** Publisher information */
	publisher?: string;
	/** Contributors list */
	contributors?: string[];
	/** Date issued */
	issued?: string;
	/** Date modified */
	modified?: string;
	/** Checking level */
	checkingLevel?: string;
	/** Any filtering applied */
	filteredBy?: Record<string, any>;
	/** Circuit breaker state if applicable */
	circuitBreakerState?: string;
	/** Pinned org had no catalog matches; body uses all-org discovery (see per-item citation.organization) */
	organizationFallback?: {
		requestedOrganization: string;
		note: string;
	};
}

/**
 * Scripture response shape
 */
export interface ScriptureResponse {
	scripture: Array<{
		text: string;
		translation: string;
		reference?: string; // Only included if different from parent reference
	}>;
	reference: string;
	language: string;
	organization: string;
	metadata: StandardMetadata;
}

/**
 * Translation helps response shape
 */
export interface TranslationHelpsResponse {
	reference: string;
	language: string;
	organization: string;
	items: Array<any>; // Specific to each help type
	metadata: StandardMetadata;
}

/**
 * List response shape (for languages, resources, etc)
 */
export interface ListResponse<T> {
	items: T[];
	metadata: StandardMetadata;
}

/**
 * Create standard scripture response
 */
export function createScriptureResponse(
	scripture: any[],
	additionalMetadata?: Partial<StandardMetadata>
): ScriptureResponse {
	const language = scripture[0]?.language || 'en';
	// Don't include organization at top level when fetching from multiple sources
	// Each scripture has its own citation.organization field for accuracy
	const organizations = Array.from(
		new Set(scripture.map((s) => s.citation?.organization || s.organization).filter(Boolean))
	);
	const organization =
		organizations.length === 1
			? organizations[0]
			: organizations.length > 1
				? 'multiple'
				: undefined;
	const reference = additionalMetadata?.reference || scripture[0]?.reference || '';

	// Clean up scripture items - keep citation for per-resource metadata
	const cleanScripture = scripture.map((s) => ({
		text: s.text,
		translation: s.translation,
		...(s.reference !== reference && { reference: s.reference }),
		// Include citation metadata for each resource
		...(s.citation && {
			citation: {
				resource: s.citation.resource,
				...(s.citation.title && { title: s.citation.title }), // ✅ FROM DCS CATALOG
				organization: s.citation.organization,
				language: s.citation.language,
				url: s.citation.url,
				version: s.citation.version
			}
		}),
		// Include resource-specific metadata if available
		...(s.metadata && { metadata: s.metadata })
	}));

	return {
		scripture: cleanScripture,
		reference,
		counts: {
			totalCount: scripture.length,
			...(additionalMetadata?.requestedResources && {
				requestedResources: additionalMetadata.requestedResources
			}),
			...(additionalMetadata?.foundResources && {
				foundResources: additionalMetadata.foundResources
			})
		},
		metadata: {
			resourceType: 'scripture',
			language,
			organization: organization || (organizations.length > 1 ? 'multiple' : 'all'),
			resources: [...new Set(scripture.map((s) => s.resource || s.translation))].filter(Boolean),
			...(organizations.length > 1 && {
				organizations: organizations
			}),
			...(additionalMetadata?.organizationFallback && {
				organizationFallback: additionalMetadata.organizationFallback
			})
		}
	};
}

/**
 * Create standard translation helps response
 */
export function createTranslationHelpsResponse(
	items: any[],
	reference: string,
	language: string = 'en',
	organization: string = 'unfoldingWord',
	resourceType: string,
	additionalMetadata?: Partial<StandardMetadata>
): TranslationHelpsResponse {
	return {
		reference,
		language,
		organization,
		items,
		metadata: {
			totalCount: items.length,
			source: resourceType.toUpperCase(),
			language,
			organization,
			resourceType,
			...additionalMetadata
		}
	};
}

/**
 * Create standard list response
 */
export function createListResponse<T>(
	items: T[],
	metadata?: Partial<StandardMetadata>
): ListResponse<T> {
	return {
		items,
		metadata: {
			totalCount: items.length,
			...metadata
		}
	};
}
