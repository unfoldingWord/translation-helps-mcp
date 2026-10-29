export type Theme = 'light' | 'dark';
const KEY = 'thmcp-theme';

export function getTheme(): Theme {
	const set = document.documentElement.dataset.theme;
	if (set === 'light' || set === 'dark') return set;
	return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function setTheme(t: Theme): void {
	document.documentElement.dataset.theme = t;
	try {
		localStorage.setItem(KEY, t);
	} catch {
		// Storage can be blocked; the choice still applies to this page.
	}
}
