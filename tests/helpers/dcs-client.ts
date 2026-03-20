/**
 * DCS API Client for Testing
 * 
 * Calls the Door43 Content Service API directly to verify source of truth.
 * Used to compare our API responses against actual DCS catalog data.
 */

const DCS_BASE_URL = 'https://git.door43.org';

export interface DCSResource {
  name: string;
  owner: string;
  language: string;
  subject: string;
  title: string;
  url: string;
  metadata?: any;
}

export interface DCSCatalogResponse {
  ok: boolean;
  data: DCSResource[];
  last_updated?: string;
}

/**
 * Search DCS catalog for resources
 */
export async function searchDCSCatalog(params: {
  language?: string;
  owner?: string;
  subject?: string;
  stage?: string;
  metadataType?: string;
  topic?: string;
  limit?: number;
}): Promise<DCSCatalogResponse> {
  const url = new URL(`${DCS_BASE_URL}/api/v1/catalog/search`);
  
  // Add parameters
  if (params.language) url.searchParams.set('lang', params.language);
  if (params.owner) url.searchParams.set('owner', params.owner);
  if (params.subject) url.searchParams.set('subject', params.subject);
  if (params.stage) url.searchParams.set('stage', params.stage || 'prod');
  if (params.metadataType) url.searchParams.set('metadataType', params.metadataType);
  if (params.topic) url.searchParams.set('topic', params.topic);
  if (params.limit) url.searchParams.set('limit', params.limit.toString());

  const response = await fetch(url.toString());
  
  if (!response.ok) {
    throw new Error(`DCS API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Check if a specific resource exists in DCS
 */
export async function dcsResourceExists(params: {
  language: string;
  organization?: string;
  subject: string;
  resourceType?: string; // tn, tq, tw, ta
}): Promise<{ exists: boolean; resource?: DCSResource }> {
  const searchParams: any = {
    language: params.language,
    subject: params.subject,
    stage: 'prod',
    limit: 100,
  };

  // Only add owner if explicitly specified (empty means search all)
  if (params.organization && params.organization !== '') {
    searchParams.owner = params.organization;
  }

  const result = await searchDCSCatalog(searchParams);
  
  if (!result.ok || !result.data || result.data.length === 0) {
    return { exists: false };
  }

  // If resourceType specified, filter by it
  let filteredResources = result.data;
  if (params.resourceType) {
    filteredResources = result.data.filter(r => 
      r.name.includes(`_${params.resourceType}`)
    );
  }

  return {
    exists: filteredResources.length > 0,
    resource: filteredResources[0]
  };
}

/**
 * Check if Translation Academy article exists in DCS
 */
export async function dcsAcademyExists(params: {
  path: string;
  language: string;
  organization?: string;
}): Promise<{ exists: boolean; actualLanguage?: string; actualOrganization?: string }> {
  const result = await dcsResourceExists({
    language: params.language,
    organization: params.organization,
    subject: 'Translation Academy',
    resourceType: 'ta'
  });

  if (!result.exists || !result.resource) {
    return { exists: false };
  }

  // Extract actual values from DCS response
  return {
    exists: true,
    actualLanguage: result.resource.language,
    actualOrganization: result.resource.owner,
  };
}

/**
 * Check if Translation Word exists in DCS
 */
export async function dcsWordExists(params: {
  path: string;
  language: string;
  organization?: string;
  category?: string;
}): Promise<{ exists: boolean; actualLanguage?: string; actualOrganization?: string }> {
  const result = await dcsResourceExists({
    language: params.language,
    organization: params.organization,
    subject: 'Translation Words',
    resourceType: 'tw'
  });

  if (!result.exists || !result.resource) {
    return { exists: false };
  }

  return {
    exists: true,
    actualLanguage: result.resource.language,
    actualOrganization: result.resource.owner,
  };
}

/**
 * Check if Scripture exists in DCS
 */
export async function dcsScriptureExists(params: {
  language: string;
  organization?: string;
}): Promise<{ exists: boolean; actualLanguage?: string; actualOrganization?: string }> {
  const result = await dcsResourceExists({
    language: params.language,
    organization: params.organization,
    subject: 'Bible',
  });

  if (!result.exists || !result.resource) {
    // Also try "Aligned Bible"
    const alignedResult = await dcsResourceExists({
      language: params.language,
      organization: params.organization,
      subject: 'Aligned Bible',
    });

    if (!alignedResult.exists || !alignedResult.resource) {
      return { exists: false };
    }

    return {
      exists: true,
      actualLanguage: alignedResult.resource.language,
      actualOrganization: alignedResult.resource.owner,
    };
  }

  return {
    exists: true,
    actualLanguage: result.resource.language,
    actualOrganization: result.resource.owner,
  };
}

/**
 * Get all available languages from DCS
 */
export async function dcsGetLanguages(): Promise<string[]> {
  const url = `${DCS_BASE_URL}/catalog/list/languages?stage=prod`;
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`DCS API error: ${response.status}`);
  }

  const data = await response.json();
  const languages: string[] = [];

  const languageData = data.data || data || [];
  languageData.forEach((lang: { lc?: string }) => {
    if (lang.lc) {
      languages.push(lang.lc);
    }
  });

  return languages;
}

/**
 * Get language variants from DCS for a base language
 */
export async function dcsGetLanguageVariants(baseLanguage: string): Promise<string[]> {
  const allLanguages = await dcsGetLanguages();
  
  // Find all variants that start with the base language
  // e.g., for "es", find ["es", "es-419", "es-ES", etc.]
  const variants = allLanguages.filter(lang => 
    lang.toLowerCase().startsWith(baseLanguage.toLowerCase())
  );

  return variants;
}

/**
 * Compare our API response with DCS source of truth
 */
export async function comparewithDCS(params: {
  endpoint: string;
  language: string;
  organization?: string;
  subject: string;
  ourResponse: any;
}): Promise<{
  matches: boolean;
  differences: string[];
  dcsData: { exists: boolean; actualLanguage?: string; actualOrganization?: string };
}> {
  const differences: string[] = [];

  // Check if resource exists in DCS
  const dcsResult = await dcsResourceExists({
    language: params.language,
    organization: params.organization,
    subject: params.subject,
  });

  // Compare existence
  const weFoundIt = !params.ourResponse.error && params.ourResponse.statusCode !== 404;
  const dcsHasIt = dcsResult.exists;

  if (weFoundIt && !dcsHasIt) {
    differences.push(`We returned data but DCS says resource doesn't exist`);
  }

  if (!weFoundIt && dcsHasIt) {
    differences.push(`We returned 404 but DCS has the resource`);
  }

  // Compare metadata (if both found it)
  if (weFoundIt && dcsHasIt && dcsResult.resource) {
    // Check language
    if (params.ourResponse.metadata?.language) {
      if (params.ourResponse.metadata.language !== dcsResult.resource.language) {
        differences.push(
          `Language mismatch: Ours="${params.ourResponse.metadata.language}", DCS="${dcsResult.resource.language}"`
        );
      }
    }

    // Check organization
    if (params.ourResponse.metadata?.organization) {
      if (params.ourResponse.metadata.organization !== dcsResult.resource.owner) {
        differences.push(
          `Organization mismatch: Ours="${params.ourResponse.metadata.organization}", DCS="${dcsResult.resource.owner}"`
        );
      }
    }
  }

  return {
    matches: differences.length === 0,
    differences,
    dcsData: {
      exists: dcsResult.exists,
      actualLanguage: dcsResult.resource?.language,
      actualOrganization: dcsResult.resource?.owner,
    }
  };
}
