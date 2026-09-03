export const GOAL_STATE_VERSION = 1;
export const DEFAULT_MAX_CONTINUATIONS = 100;

export type GoalStatus = "pursuing" | "paused" | "blocked" | "achieved" | "budget-limited";

export interface GoalState {
	version: typeof GOAL_STATE_VERSION;
	objective: string;
	status: GoalStatus;
	startedAt: number;
	elapsedMs: number;
	turns: number;
	tokens: number;
	continuations: number;
	evidence?: string;
	reason?: string;
}

export interface PersistedGoalSnapshot {
	version: typeof GOAL_STATE_VERSION;
	state: GoalState | null;
}

export interface GoalBudgets {
	maxContinuations: number;
}

type Clock = () => number;

const GOAL_STATUSES = new Set<GoalStatus>([
	"pursuing",
	"paused",
	"blocked",
	"achieved",
	"budget-limited",
]);

function isFiniteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseGoalState(value: unknown): GoalState | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const candidate = value as Partial<GoalState>;
	if (candidate.version !== GOAL_STATE_VERSION) return undefined;
	if (typeof candidate.objective !== "string" || candidate.objective.trim() === "") return undefined;
	if (typeof candidate.status !== "string" || !GOAL_STATUSES.has(candidate.status as GoalStatus)) return undefined;
	if (!isFiniteNonNegative(candidate.startedAt)) return undefined;
	if (!isFiniteNonNegative(candidate.elapsedMs)) return undefined;
	if (!isFiniteNonNegative(candidate.turns)) return undefined;
	if (!isFiniteNonNegative(candidate.tokens)) return undefined;
	if (!isFiniteNonNegative(candidate.continuations)) return undefined;
	if (candidate.evidence !== undefined && typeof candidate.evidence !== "string") return undefined;
	if (candidate.reason !== undefined && typeof candidate.reason !== "string") return undefined;

	return {
		version: GOAL_STATE_VERSION,
		objective: candidate.objective.trim(),
		status: candidate.status as GoalStatus,
		startedAt: candidate.startedAt,
		elapsedMs: candidate.elapsedMs,
		turns: Math.floor(candidate.turns),
		tokens: Math.floor(candidate.tokens),
		continuations: Math.floor(candidate.continuations),
		evidence: candidate.evidence,
		reason: candidate.reason,
	};
}

export function parseGoalSnapshot(value: unknown): GoalState | null | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const snapshot = value as Partial<PersistedGoalSnapshot>;
	if (snapshot.version !== GOAL_STATE_VERSION) return undefined;
	if (snapshot.state === null) return null;
	return parseGoalState(snapshot.state);
}

export class GoalController {
	private state: GoalState | undefined;
	private activeSince: number | undefined;

	constructor(
		private readonly now: Clock = Date.now,
		private readonly budgets: GoalBudgets = {
			maxContinuations: DEFAULT_MAX_CONTINUATIONS,
		},
	) {}

	get current(): Readonly<GoalState> | undefined {
		return this.state;
	}

	get isPursuing(): boolean {
		return this.state?.status === "pursuing";
	}

	start(objective: string): Readonly<GoalState> {
		const timestamp = this.now();
		this.state = {
			version: GOAL_STATE_VERSION,
			objective: objective.trim(),
			status: "pursuing",
			startedAt: timestamp,
			elapsedMs: 0,
			turns: 0,
			tokens: 0,
			continuations: 0,
		};
		this.activeSince = timestamp;
		return this.state;
	}

	restore(state: GoalState | null): void {
		this.state = state === null ? undefined : { ...state };
		this.activeSince = this.state?.status === "pursuing" ? this.now() : undefined;
	}

	pause(reason?: string): boolean {
		if (!this.isPursuing || this.state === undefined) return false;
		this.finishActivePeriod();
		this.state.status = "paused";
		this.state.reason = reason;
		return true;
	}

	resume(): boolean {
		if (this.state === undefined) return false;
		if (!["paused", "blocked", "budget-limited"].includes(this.state.status)) return false;
		this.state.status = "pursuing";
		this.state.reason = undefined;
		this.activeSince = this.now();
		return true;
	}

	achieve(evidence: string): boolean {
		if (!this.isPursuing || this.state === undefined) return false;
		this.finishActivePeriod();
		this.state.status = "achieved";
		this.state.evidence = evidence.trim();
		this.state.reason = undefined;
		return true;
	}

	block(reason: string): boolean {
		if (!this.isPursuing || this.state === undefined) return false;
		this.finishActivePeriod();
		this.state.status = "blocked";
		this.state.reason = reason.trim();
		return true;
	}

	limitBudget(reason: string): boolean {
		if (!this.isPursuing || this.state === undefined) return false;
		this.finishActivePeriod();
		this.state.status = "budget-limited";
		this.state.reason = reason;
		return true;
	}

	clear(): boolean {
		if (this.state === undefined) return false;
		if (this.isPursuing) this.finishActivePeriod();
		this.state = undefined;
		this.activeSince = undefined;
		return true;
	}

	recordTurn(tokens: number): void {
		if (this.state === undefined) return;
		this.state.turns += 1;
		this.state.tokens += Math.max(0, Math.floor(tokens));
	}

	recordContinuation(): void {
		if (!this.isPursuing || this.state === undefined) return;
		this.state.continuations += 1;
	}

	budgetReason(): string | undefined {
		if (this.state === undefined) return undefined;
		if (this.state.continuations >= this.budgets.maxContinuations) {
			return `Automatic continuation budget reached (${this.budgets.maxContinuations}).`;
		}
		return undefined;
	}

	elapsedMs(): number {
		if (!this.isPursuing || this.activeSince === undefined || this.state === undefined) {
			return this.state?.elapsedMs ?? 0;
		}
		return this.state.elapsedMs + Math.max(0, this.now() - this.activeSince);
	}

	serialize(): PersistedGoalSnapshot {
		if (this.state === undefined) {
			return { version: GOAL_STATE_VERSION, state: null };
		}
		return {
			version: GOAL_STATE_VERSION,
			state: { ...this.state, elapsedMs: this.elapsedMs() },
		};
	}

	private finishActivePeriod(): void {
		if (this.state === undefined || this.activeSince === undefined) return;
		this.state.elapsedMs += Math.max(0, this.now() - this.activeSince);
		this.activeSince = undefined;
	}
}

export function formatDuration(milliseconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
	const hours = Math.floor(totalSeconds / 3_600);
	const minutes = Math.floor((totalSeconds % 3_600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

export function formatTokenCount(tokens: number): string {
	if (tokens < 1_000) return String(tokens);
	if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
	return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}m`;
}
