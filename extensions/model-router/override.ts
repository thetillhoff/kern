// In-process model-selection state shared across sessions (one Node process).
// model-router owns this; the task extension imports setTierOverride to pass an
// explicit subagent tier into a child session's routing.

// sessionId -> tier requested by a task() call for that child session.
const tierOverrides = new Map<string, string>();
// sessions whose model the human pinned (explicit selection); router skips them.
const pinnedSessions = new Set<string>();
// sessionId -> the model id the router itself last set, so the model_select
// handler can distinguish the router's own setModel from a human selection.
const routerSet = new Map<string, string>();

export function setTierOverride(sessionId: string, tier: string): void {
	tierOverrides.set(sessionId, tier);
}

export function takeTierOverride(sessionId: string): string | undefined {
	const tier = tierOverrides.get(sessionId);
	tierOverrides.delete(sessionId);
	return tier;
}

export function pinSession(sessionId: string): void {
	pinnedSessions.add(sessionId);
}

export function isPinned(sessionId: string): boolean {
	return pinnedSessions.has(sessionId);
}

export function noteRouterSet(sessionId: string, modelId: string): void {
	routerSet.set(sessionId, modelId);
}

export function wasRouterSet(sessionId: string, modelId: string): boolean {
	return routerSet.get(sessionId) === modelId;
}
