export const SESSION_KINDS = [
  "observe",
  "complete",
  "debug",
  "build",
  "refactor",
  "compare",
  "test",
  "integrate",
  "review",
  "ship"
] as const;

export type SessionKind = (typeof SESSION_KINDS)[number];

export const CHECK_LABELS = [
  "quiz",
  "review",
  "typecheck",
  "lint",
  "unit",
  "integration",
  "storybook",
  "a11y",
  "e2e",
  "build",
  "docker",
  "ci",
  "deploy",
  "observability"
] as const;

export type CheckLabel = (typeof CHECK_LABELS)[number];

export interface SessionDefinition {
  id: string;
  title: string;
  minutes: number;
  kind: SessionKind;
  outcome: string;
  done: string;
  checks: CheckLabel[];
  requires: string[];
  introduces: string[];
  defers: string[];
}

export interface CourseModule {
  id: string;
  slug: string;
  title: string;
  goal: string;
  sessions: SessionDefinition[];
}

export interface CapstoneDefinition {
  id: string;
  title: string;
  goal: string;
  sessions: SessionDefinition[];
}

export interface CourseManifest {
  version: number;
  language: string;
  audience: string;
  assumedConcepts: string[];
  estimatedHours: {
    min: number;
    max: number;
  };
  sessionPolicy: {
    minMinutes: number;
    maxMinutes: number;
    singleActiveSession: boolean;
    dependencyMode: string;
    startState: string;
    finishState: string;
  };
  modules: CourseModule[];
  capstone: CapstoneDefinition;
}

export interface FlatSession {
  index: number;
  definition: SessionDefinition;
  module: CourseModule | null;
  isCapstone: boolean;
}

export type CheckStatus = "passed" | "failed" | "manual";

export interface CheckResult {
  label: CheckLabel;
  status: CheckStatus;
  exitCode: number | null;
  output: string;
}

export interface CheckRun {
  sessionId: string;
  checkedAt: string;
  contentHash: string;
  passed: boolean;
  results: CheckResult[];
}

export type ReviewVerdict = "PASS" | "NEEDS_WORK";

export interface ReviewRecord {
  sessionId: string;
  reviewedAt: string;
  contentHash: string;
  verdict: ReviewVerdict;
}

export interface ProgressState {
  schemaVersion: 1;
  activeSessionId: string | null;
  completedSessionIds: string[];
  startedAt: string | null;
  lastCheck: CheckRun | null;
  lastReview: ReviewRecord | null;
  revealedHintLevel: number;
}

export interface Checkpoint {
  schemaVersion: 1;
  sessionId: string;
  finishedAt: string;
  contentHash: string;
}
