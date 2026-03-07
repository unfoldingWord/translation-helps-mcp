/**
 * Response Formatter Utility
 * 
 * Centralized response formatting for all output formats (JSON, text, markdown, USFM)
 */

/**
 * Format any response data to the requested format
 */
export function formatResponse(data: any, format: 'json' | 'text' | 'markdown' | 'md' | 'usfm'): any {
  switch (format) {
    case 'json':
      return data;
    
    case 'text':
      return formatAsText(data);
    
    case 'markdown':
    case 'md':
      return formatAsMarkdown(data);
    
    case 'usfm':
      // USFM is handled by the core service, return as-is
      return data;
    
    default:
      return data;
  }
}

/**
 * Format data as plain text
 */
function formatAsText(data: any): string {
  // Handle scripture data
  if (data.scripture && Array.isArray(data.scripture)) {
    return data.scripture
      .map((item: any) => {
        const citation = `${item.translation} (${item.citation.organization})`;
        return `${citation}\n\n${item.text}\n`;
      })
      .join('\n---\n\n');
  }

  // Handle translation notes
  if (data.notes && Array.isArray(data.notes)) {
    return data.notes
      .map((note: any) => {
        const citation = note.citation ? `[${note.citation.resource} - ${note.citation.organization}]\n` : '';
        return `${citation}${note.text || note.Note || ''}`;
      })
      .join('\n\n---\n\n');
  }

  // Handle translation questions
  if (data.questions && Array.isArray(data.questions)) {
    return data.questions
      .map((q: any, idx: number) => {
        const citation = q.citation ? `[${q.citation.resource} - ${q.citation.organization}]\n` : '';
        return `${citation}Q${idx + 1}: ${q.question}\nA: ${q.answer}`;
      })
      .join('\n\n---\n\n');
  }

  // Handle translation words
  if (data.article) {
    const citation = data.citation ? `[${data.citation.resource} - ${data.citation.organization}]\n\n` : '';
    return `${citation}${data.article}`;
  }

  // Fallback to JSON string
  return JSON.stringify(data, null, 2);
}

/**
 * Format data as markdown
 */
function formatAsMarkdown(data: any): string {
  // Handle scripture data
  if (data.scripture && Array.isArray(data.scripture)) {
    const reference = data.reference || 'Scripture';
    let md = `# ${reference}\n\n`;
    
    md += '## Scripture Text\n\n';
    md += data.scripture
      .map((item: any) => {
        const citation = `**${item.translation}** _(${item.citation.organization})_`;
        return `${citation}\n\n${item.text}\n`;
      })
      .join('\n');
    
    return md;
  }

  // Handle translation notes
  if (data.notes && Array.isArray(data.notes)) {
    const reference = data.reference || 'Notes';
    let md = `# Translation Notes: ${reference}\n\n`;
    
    md += data.notes
      .map((note: any, idx: number) => {
        const citation = note.citation 
          ? `_Source: ${note.citation.resource} (${note.citation.organization})_\n\n` 
          : '';
        return `## Note ${idx + 1}\n\n${citation}${note.text || note.Note || ''}`;
      })
      .join('\n\n---\n\n');
    
    return md;
  }

  // Handle translation questions
  if (data.questions && Array.isArray(data.questions)) {
    const reference = data.reference || 'Questions';
    let md = `# Translation Questions: ${reference}\n\n`;
    
    md += data.questions
      .map((q: any, idx: number) => {
        const citation = q.citation 
          ? `_Source: ${q.citation.resource} (${q.citation.organization})_\n\n` 
          : '';
        return `## Question ${idx + 1}\n\n${citation}**Q:** ${q.question}\n\n**A:** ${q.answer}`;
      })
      .join('\n\n---\n\n');
    
    return md;
  }

  // Handle translation words
  if (data.article) {
    const term = data.term || 'Translation Word';
    let md = `# ${term}\n\n`;
    
    if (data.citation) {
      md += `_Source: ${data.citation.resource} (${data.citation.organization})_\n\n`;
    }
    
    md += data.article;
    return md;
  }

  // Fallback to code block
  return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
}
