// Shared types of the game factory. Every module codes against these, so stages, wrappers and tests agree.

export type Column = 'Design' | 'Implementation' | 'Testing' | 'Approval' | 'Done';

export type CardStage = 'design' | 'implement' | 'testing';
export type PeriodicStage = 'release' | 'maintenance';
export type Stage = CardStage | PeriodicStage | 'approve' | 'feedback' | 'change' | 'intake' | 'tick';

export type FactoryConfig = {
  repo: string; // "owner/name" on GitHub
  projectOwner: string;
  projectNumber: number;
  home: string; // $FACTORY_HOME: host clone, work clones, logs, state
  webRoot: string;
  publicUrl: string; // base of play links, no trailing slash
  image: string; // Docker image of the agent container
  oauthToken: string; // CLAUDE_CODE_OAUTH_TOKEN, the one secret agents get
  designModel: string;
  buildModel: string;
  minVotes: number;
  minAgeHours: number;
  committeeBootstrapTelegram: string; // sole member while committee.json is missing
  committeeBootstrapGithub: string;
  telegramToken: string;
  committeeChat: string;
  publicChannel: string;
  stageTimeoutMinutes: number;
  releaseDays: number;
  maintenanceHours: number;
};

export type RunOptions = { cwd?: string; env?: Record<string, string>; input?: string; logPath?: string };
export type RunResult = { code: number; stdout: string; stderr: string };
// Runs a program without a shell. Tests pass a fake that records calls.
export type Run = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

export type Reaction = { login: string; content: string };
export type IssueComment = { login: string; body: string };

export type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string; // ISO time
  state: 'OPEN' | 'CLOSED';
  thumbsUp: string[]; // logins that reacted +1
};

export type Card = { itemId: string; issue: number; column: Column; labels: string[] };

// A job is one detached `factory run` process. `issue` is null for release and maintenance, and a change id for change.
export type JobStage = CardStage | PeriodicStage | 'approve' | 'change';
export type Job = { stage: JobStage; issue: number | null; pid: number; startedAt: string; log: string };
export type ChangeRequest = { id: number; text: string; by: string };

export type FactoryState = {
  job: Job | null;
  approvalPosts: Record<string, number>; // Telegram message id -> issue number
  lastRelease: string | null; // ISO time
  lastMaintenance: string | null; // ISO time
  pendingApprovals: Record<string, string>; // issue number -> approving Telegram user, run by the next tick
  pendingChanges: ChangeRequest[]; // factory change requests, run by the next ticks in order
};

export interface GitHub {
  candidates(labels: string[]): Promise<Issue[]>;
  issue(number: number): Promise<Issue>;
  comments(number: number): Promise<IssueComment[]>;
  comment(number: number, body: string): Promise<void>;
  addLabel(number: number, label: string): Promise<void>;
  removeLabel(number: number, label: string): Promise<void>;
  close(number: number, reason: 'completed' | 'not planned'): Promise<void>;
  createIssue(title: string, body: string, labels: string[]): Promise<number>;
  editIssue(number: number, title: string, body: string): Promise<void>;
  cards(): Promise<Card[]>;
  addCard(issue: number, column: Column): Promise<void>;
  move(issue: number, column: Column): Promise<void>;
  openPullRequest(branch: string, base: string, title: string, body: string): Promise<string>;
}

export interface Telegram {
  sendMessage(chat: string, text: string, replyTo?: number): Promise<number>;
  sendPhoto(chat: string, pngPath: string, caption: string): Promise<number>;
}

export type AgentRun = { clone: string; model: string; prompt: string; log: string };

export interface Container {
  // Runs Claude Code headless in the clone. Throws on a nonzero exit.
  agent(run: AgentRun): Promise<void>;
  // Runs a bash script in the clone with no secret. Throws on a nonzero exit.
  shell(clone: string, script: string, log: string, env?: Record<string, string>): Promise<void>;
}

export interface HostRepo {
  // The host's own clone. Git never runs hooks in it.
  path: string;
  sync(): Promise<void>; // fetch origin, fast-forward dev and main
  prepareWorkClone(branch: string, base: string, dir: string): Promise<void>;
  fetchFromWork(dir: string, branch: string): Promise<void>;
  push(branch: string): Promise<void>;
  headHash(branch: string): Promise<string>; // short hash
  diff(base: string, branch: string): Promise<string>;
  hasNewCommits(base: string, branch: string): Promise<boolean>;
  merge(branch: string, into: string, message: string): Promise<void>; // throws on conflict
  mergeLog(from: string, to: string): Promise<string[]>; // first-parent merge subjects on `from` missing in `to`
}

export type Ctx = {
  cfg: FactoryConfig;
  run: Run;
  github: GitHub;
  telegram: Telegram;
  container: Container;
  repo: HostRepo;
  statePath: string;
  now: () => Date;
  log: (stage: Stage, issue: number | null, msg: string) => void;
};

export const BRANCH = (issue: number): string => `factory/issue-${issue}`;
export const TASK_FILE = (issue: number): string => `docs/tasks/issue-${issue}.md`;
export const WORK_DIR = (home: string, issue: number): string => `${home}/work/issue-${issue}`;
export const OUT_DIR = '.factory';
export const STUCK_LABEL = 'factory-stuck';
export const WONT_DO_LABEL = 'wont-do';
export const MAINTENANCE_LABEL = 'maintenance';
export const CANDIDATE_LABELS = ['feature-request', 'bug'];
export const FEEDBACK_HEADING = '## Committee feedback';
