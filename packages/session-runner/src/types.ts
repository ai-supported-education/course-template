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
  "ship",
  "derive",
  "calculate",
  "measure",
  "experiment",
  "configure",
  "diagnose",
  "design"
] as const;

export type SessionKind = (typeof SESSION_KINDS)[number];

export const CHECK_LABELS = [
  "quiz",
  "review",
  "typecheck",
  "unit",
  "integration"
] as const;

export type CheckLabel = (typeof CHECK_LABELS)[number];

export const VERIFICATION_MODES = [
  "automated",
  "empirical",
  "agent",
  "manual-approval"
] as const;

export type VerificationMode = (typeof VERIFICATION_MODES)[number];

export const SESSION_RELEASE_STATUSES = ["planned", "published"] as const;

export type SessionReleaseStatus = (typeof SESSION_RELEASE_STATUSES)[number];

export interface EvidenceContract {
  produces: string[];
  verifiedBy: VerificationMode[];
}

export interface ContentReviewFileSelection {
  learner?: string[];
  consistency?: string[];
  exclude?: string[];
}

export interface SessionRoadmapFields {
  id: string;
  title: string;
  minutes: number;
  kind: SessionKind;
  outcome: string;
  requires: string[];
  introduces: string[];
  defers: string[];
}

export interface PlannedSessionDefinition extends SessionRoadmapFields {
  releaseStatus: "planned";
}

export interface SessionDefinition extends SessionRoadmapFields {
  releaseStatus?: "published";
  done: string;
  checks: CheckLabel[];
  evidence: EvidenceContract;
  contentReview?: ContentReviewFileSelection;
}

export type CourseSessionDefinition =
  | PlannedSessionDefinition
  | SessionDefinition;

export interface CourseModule {
  id: string;
  slug: string;
  title: string;
  goal: string;
  sessions: CourseSessionDefinition[];
}

export interface CapstoneDefinition {
  id: string;
  title: string;
  goal: string;
  sessions: CourseSessionDefinition[];
}

export interface CourseManifest {
  version: number;
  language: string;
  audience: string;
  profiles: string[];
  courseContextFiles?: string[];
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

export interface FlatRoadmapSession {
  index: number;
  definition: CourseSessionDefinition;
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
