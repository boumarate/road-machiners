// Shared types of the game factory. Every module codes against these, so stages, wrappers and tests agree.

export type Column = 'Triage' | 'Design' | 'Implementation' | 'Testing' | 'Approval' | 'Done';

export type CardStage = 'triage' | 'design' | 'implement' | 'testing';
export type ReleaseStage = 'release' | 'candidate' | 'ship' | 'remove';
export type Stage = CardStage | ReleaseStage | 'approve' | 'feedback' | 'change' | 'adhoc' | 'dev' | 'intake' | 'tick';

export type FactoryConfig = {
  repo: string; // "owner/name" on GitHub
  projectOwner: string;
  projectNumber: number;
  home: string; // $FACTORY_HOME: host clone, work clones, logs, state
  webRoot: string;
  publicUrl: string; // base of play links, no trailing slash
  image: string; // Docker image of the agent container
  oauthToken: string; // CLAUDE_CODE_OAUTH_TOKEN
  elevenlabsKey: string; // ELEVENLABS_API_KEY, for the game's sfx:gen in agent runs
  sfxMaxGenerations: number; // most ElevenLabs generations one sfx:gen run may make
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
  updateGraceMinutes: number; // minutes a factory update waits for agent and test jobs before it stops them
  releaseDays: number;
  itchTarget: string | null; // itch.io page as "user/game". Null until set, and then a release fails loud.
  butlerKey: string | null; // BUTLER_API_KEY, only ever in the env of the butler call
  maxJobsPerDay: number; // public-driven agent jobs allowed in any 24 hours
  agentWorkers: number; // jobs of the agent queue that run at once
  testWorkers: number; // jobs of the test queue that run at once
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
  author: string; // login of the issue author
  thumbsUp: string[]; // logins that reacted +1
};

export type Card = { itemId: string; issue: number; column: Column; labels: string[] };

// A job is one detached `factory run` process. `issue` is null for the release cut and a change id for change.
// Candidate and ship carry the tracking issue, remove the issue of the feature to take out. Dev rebuilds /dev/ and has no issue.
export type JobStage = CardStage | ReleaseStage | 'approve' | 'change' | 'adhoc' | 'dev';
// `id` names the job's containers, so a kill stops only its own.
export type Job = { id: string; stage: JobStage; issue: number | null; pid: number; startedAt: string; log: string };

// Jobs run in parallel up to a limit per queue.
// The branch queue moves dev, main and the release, or rebuilds a shared build, so it runs one job at a time.
// The agent queue runs light agent jobs. The test queue builds the game and plays it in a browser, which is heavy.
export type Queue = 'branch' | 'agent' | 'test';
export const QUEUE_OF: Record<JobStage, Queue> = {
  triage: 'agent', design: 'agent', implement: 'agent', adhoc: 'agent',
  testing: 'test',
  approve: 'branch', remove: 'branch', ship: 'branch', release: 'branch', candidate: 'branch', dev: 'branch', change: 'branch',
};
// `error` is the short summary. The full text is in `log`.
export type Failure = { stage: Stage; issue: number | null; error: string; log: string | null; at: string };
export type ChangeRequest ={ id: number; text: string; by: string };
export type Removal = { issue: number; by: string; text: string };

// The open release. Its branch takes the release tasks, and Ship merges it into main.
export type ReleaseState = {
  issue: number; // tracking issue
  branch: string;
  day: string; // YYYY-MM-DD of the cut
  postId: number | null; // Telegram id of the current candidate post. Null while none is current.
  removed: number[]; // feature issues taken out of this release
};

export type FactoryState = {
  jobs: Job[]; // running jobs, at most one per issue
  approvalPosts: Record<string, number>; // Telegram message id -> issue number
  lastRelease: string | null; // ISO time
  release: ReleaseState | null;
  pendingShip: string | null; // Telegram user who pressed Ship, run by the next tick
  pendingRemovals: Removal[]; // features to take out of the release, run by the next ticks in order
  pendingApprovals: Record<string, string>; // issue number -> approving Telegram user, run by the next tick
  approvedResolving: Record<string, string>; // issue number -> approver, for an approved card back in Testing to resolve a conflict with its base. Testing then queues its merge with no new post.
  pendingChanges: ChangeRequest[]; // factory change requests, run by the next ticks in order
  lastTickError: string | null; // the last tick crash. Hermes's incident watch reports it.
  failures: Failure[]; // failed jobs of the last day. Hermes's incident watch reports each one, and the chat hears of it only from Hermes.
  adhocReplies: Record<string, { chat: string; messageId: number }>; // ad hoc issue number -> the chat message its report answers
  builds: Record<string, string>; // issue number -> folder name of its deployed build under the web root
  jobStarts: string[]; // ISO start times of public-driven jobs in the last 24 hours
  capNoticed: boolean; // the committee heard that the daily job cap blocks work, until the cap frees
  postCaptions: Record<string, string>; // Telegram message id -> caption of an open approval or candidate post. Telegram cannot read a caption back, and a status line edits it.
  devBuild: string | null; // short hash of dev that /dev/ serves
  devFailed: string | null; // short hash of dev whose build failed. The tick skips it until dev moves or Hermes clears it.
  interrupted: number[]; // issues whose job a factory update stopped. The next job on the issue tells its agent to continue, and its end clears the issue.
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
  createRelease(tag: string, target: string, title: string, notes: string): Promise<void>; // tags `target` and publishes a GitHub release
  pullRequestFor(branch: string): Promise<string | null>; // URL of the open pull request with that head branch
  closePullRequest(branch: string, comment: string): Promise<void>;
  reopen(number: number): Promise<void>;
}

// One inline keyboard button. `data` comes back as the callback data of a press.
export type InlineButton = { text: string; data: string };

// One photo of an album, with its own caption.
export type AlbumPhoto = { path: string; caption: string };

export interface Telegram {
  sendMessage(chat: string, text: string, replyTo?: number): Promise<number>;
  sendPhoto(chat: string, pngPath: string, caption: string, buttons?: InlineButton[][]): Promise<number>;
  // Sends 1 to 10 photos as one photo or one album, with no buttons, optionally as a reply. Returns the message ids in order.
  sendPhotos(chat: string, photos: AlbumPhoto[], replyTo?: number): Promise<number[]>;
  sendDocument(chat: string, path: string, replyTo?: number): Promise<number>;
  editCaption(chat: string, messageId: number, caption: string): Promise<void>; // replaces a photo's caption and drops its buttons
}

// `dir` is the repo folder the agent works in, `game` or `factory`. The container starts it there.
// `openNetwork` runs the container on the normal network with no proxy. Absent means the restricted network.
// `mediaDir` is a host folder of reference images. The agent sees it read only at /work/.factory-media.
// `readOnly` maps host folders to container paths, mounted read only.
export type AgentRun = { clone: string; dir: string; model: string; prompt: string; log: string; openNetwork?: boolean; mediaDir?: string; readOnly?: Record<string, string> };

export interface Container {
  // Runs Claude Code headless in the clone. Throws on a nonzero exit.
  agent(run: AgentRun): Promise<void>;
  // Runs a bash script in the game folder of the clone with no secret. It only runs game npm scripts. Throws on a nonzero exit.
  shell(clone: string, script: string, log: string, env?: Record<string, string>): Promise<void>;
}

// Merge `branch` into `into` with a merge commit titled `message`.
export type MergeStep = { branch: string; into: string; message: string };

// Branch names in every call mean GitHub's branches. A write reaches GitHub at once or fails with nothing changed.
export interface HostRepo {
  // The host's own clone. Git never runs hooks in it.
  path: string;
  fetch(): Promise<void>; // fetch GitHub, cloning first when the clone is missing
  createBranch(name: string, from: string): Promise<void>; // throws when the branch exists
  // Reverts the newest first-parent merge `Merge issue #N:` in main..branch and pushes. False when the branch lacks it. A conflict throws.
  revertIssueMerge(issue: number, branch: string): Promise<boolean>;
  deleteBranch(branch: string): Promise<void>; // on GitHub, if it is there
  prepareWorkClone(branch: string, base: string, dir: string): Promise<void>;
  // Agent skills expect their task file in git and commit it. This commits its removal, keeps it on disk, and returns the removed paths.
  untrackFactoryFiles(dir: string): Promise<string[]>;
  // Brings the work clone's branch head into the host clone, without pushing it, and returns its full hash.
  fetchFromWork(dir: string, branch: string): Promise<string>;
  push(commit: string, branch: string): Promise<void>; // sets `branch` on GitHub to `commit`, which must hold the branch's current head
  // Merges `base` into the checked-out branch of a work clone. Returns the merged commit and the conflicted files, and leaves a conflicted merge open for an agent. No conflicts means it merged.
  // Parallel jobs move `base` on, so a later check names the returned commit, not the branch.
  mergeBaseIntoWork(dir: string, base: string): Promise<{ commit: string; conflicts: string[] }>;
  isMerged(base: string, branch: string): Promise<boolean>; // whether `branch` holds every commit of `base`, a branch or a commit
  headHash(branch: string): Promise<string>; // short hash
  diff(base: string, branch: string): Promise<string>;
  changedFiles(base: string, branch: string): Promise<string[]>; // files `branch` changed since it split from `base`
  hasNewCommits(base: string, branch: string): Promise<boolean>;
  // Runs the steps in order and pushes every changed branch in one atomic push. A conflict throws MergeConflictError before the push.
  merge(steps: MergeStep[]): Promise<void>;
  mergeLog(from: string, to: string): Promise<string[]>; // first-parent merge subjects on `from` missing in `to`
}

// A merge that stopped on conflicting files. Nothing changed on GitHub when this is thrown.
export class MergeConflictError extends Error {
  constructor(readonly branch: string, readonly into: string, readonly files: string[], reason: string) {
    super(`merge of ${branch} into ${into} failed. Conflicting files: ${files.join(', ')}. ${reason}`);
  }
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
  fetch?: typeof fetch; // the host's HTTP client for reference images. Absent means the global one.
  log: (stage: Stage, issue: number | null, msg: string) => void;
};

// The two folders of the repo. Agents run in one of them, and their files live there.
export const GAME_DIR = 'game';
export const FACTORY_DIR = 'factory';
export const BRANCH = (issue: number): string => `factory/issue-${issue}`;
// Task files stay in the work clone and never reach a commit. Git ignores their folder there.
// TASK_FILE and OUT_DIR are relative to the agent folder, which is the agent's working directory.
export const TASK_DIR = '.factory-tasks';
export const TASK_FILE = (issue: number): string => `${TASK_DIR}/issue-${issue}.md`;
export const WORK_DIR = (home: string, issue: number): string => `${home}/work/issue-${issue}`;
export const OUT_DIR = '.factory';
// Reference images mount here inside the clone. The folder never reaches a commit.
export const MEDIA_DIR = '.factory-media';
export const STUCK_LABEL = 'factory-stuck';
export const WONT_DO_LABEL = 'wont-do';
export const MAINTENANCE_LABEL = 'maintenance';
export const RELEASE_LABEL = 'release'; // the tracking issue of the open release
export const RELEASE_TASK_LABEL = 'release-task'; // work that runs on the release branch
export const RELEASE_CANDIDATE_LABEL = 'release-candidate'; // approved and merged, waiting for a ship to main. The issue closes on ship.
// A fix for a shipped bug. It branches from main, and its approval ships it to main and itch.io at once. Only collaborators set labels, so it needs no votes.
export const HOTFIX_LABEL = 'hotfix';
export const ADHOC_LABEL = 'adhoc';
export const CANDIDATE_LABELS = ['feature-request', 'bug'];
export const NEEDS_INFO_LABEL = 'needs-info';
export const FACTORY_MARK = '<!-- roam-factory -->'; // last line of every factory comment, so a factory comment differs from a member's
export const QUESTIONS_HEADING = '## Questions from the factory';
export const FEEDBACK_HEADING = '## Committee feedback';
// Agent containers sit on an internal Docker network. The proxy container is their only way out.
export const AGENT_NETWORK = 'roam-factory-agents';
export const PROXY_NAME = 'roam-factory-proxy';
export const PROXY_PORT = 8888;
// Model routing. Baseline: design Opus, implementation and testing Sonnet. Explicit labels beat anything triage decided.
export const DESIGN_SONNET_LABEL = 'design-sonnet'; // design runs on the build (Sonnet) model
export const IMPLEMENTATION_OPUS_LABEL = 'implementation-opus'; // implementation and every testing pass run on the design (Opus) model
export const ROUTING_MARK = 'Model routing from triage:'; // triage's routing comment. Its presence means triage decided once and never relabels.
export const OPEN_NETWORK_LABEL = 'open-network';
