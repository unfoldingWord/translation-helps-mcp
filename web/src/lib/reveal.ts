/**
 * On narrow screens the result sits below the controls, so a choice can change
 * nothing visible. Scroll the result to the top of the screen, unless it is
 * already in view. Wide screens show controls and result side by side.
 */
export function revealOnNarrow(el: Element | null | undefined): void {
	if (!el || typeof window === 'undefined') return;
	if (!window.matchMedia('(max-width: 1023px)').matches) return;
	const top = el.getBoundingClientRect().top;
	if (top >= 56 && top < window.innerHeight * 0.5) return;
	const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}
