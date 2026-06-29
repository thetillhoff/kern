// In-process model-selection state shared across sessions AND across extensions
// (one Node process). model-router owns this; the task extension imports
// setTierOverride to pass an explicit subagent tier into a child session's
// routing.
//
// Backed by globalThis: the extension loader gives each extension its own
// module graph, so a plain module-level Map in this file is NOT shared between
// the task extension and the model-router extension (verified: a tier set by
// task was invisible to the router). globalThis is the single shared point in
// the process, immune to that module duplication.

interface OverrideStore {
	// sessionId -> tier requested by a task() call for that child session.
	tierOverrides: Map<string, string>;
	// sessions whose model the human pinned (explicit selection); router skips.
	pinnedSessions: Set<string>;
	// sessionId -> the model id the router itself last set, so the model_select
	// handler can distinguish the router's own setModel from a human selection.
	routerSet: Map<string, string>;
}

const g = globalThis as typeof globalThis & {
	__kernModelRouterOverride?: OverrideStore;
};

if (!g.__kernModelRouterOverride) {
	g.__kernModelRouterOverride = {
		tierOverrides: new Map(),
		pinnedSessions: new Set(),
		routerSet: new Map(),
	};
}
const store: OverrideStore = g.__kernModelRouterOverride;

export function setTierOverride(sessionId: string, tier: string): void {
	store.tierOverrides.set(sessionId, tier);
}

export function takeTierOverride(sessionId: string): string | undefined {
	const tier = store.tierOverrides.get(sessionId);
	store.tierOverrides.delete(sessionId);
	return tier;
}

export function pinSession(sessionId: string): void {
	store.pinnedSessions.add(sessionId);
}

export function isPinned(sessionId: string): boolean {
	return store.pinnedSessions.has(sessionId);
}

export function noteRouterSet(sessionId: string, modelId: string): void {
	store.routerSet.set(sessionId, modelId);
}

export function wasRouterSet(sessionId: string, modelId: string): boolean {
	return store.routerSet.get(sessionId) === modelId;
}

export function clearSession(sessionId: string): void {
	store.tierOverrides.delete(sessionId);
	store.pinnedSessions.delete(sessionId);
	store.routerSet.delete(sessionId);
}

export function clearStore(): void {
	store.tierOverrides.clear();
	store.pinnedSessions.clear();
	store.routerSet.clear();
}
