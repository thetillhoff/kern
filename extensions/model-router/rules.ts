export interface RoutingRule {
	if: {
		keywords?: string[];
		tokenCount?: { lt?: number; gt?: number };
	};
	tier: string;
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/**
 * Returns the first matching tier name, or null if no rule matches.
 * Rules are checked in order; first match wins.
 */
export function applyRules(
	lastMessage: string,
	tokenCount: number,
	rules: RoutingRule[],
): string | null {
	const lower = lastMessage.toLowerCase();
	for (const rule of rules) {
		const { if: cond } = rule;

		if (cond.keywords?.some((k) => lower.includes(k.toLowerCase()))) {
			return rule.tier;
		}

		if (cond.tokenCount) {
			const { lt, gt } = cond.tokenCount;
			if (lt !== undefined && tokenCount < lt) return rule.tier;
			if (gt !== undefined && tokenCount > gt) return rule.tier;
		}
	}
	return null;
}
