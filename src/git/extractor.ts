import { simpleGit, SimpleGit } from 'simple-git';
import { DiffParser, ParsedDiff } from './parser';

export interface DiffOptions {
    staged?: boolean;
    context?: number;
}

export interface CommitInfo {
    hash: string;
    date: string;
    message: string;
    author: string;
    files: string[];
}

export interface BranchInfo {
    name: string;
    current: boolean;
    commit: string;
}

export type BranchKind = 'local' | 'remote';
export type BranchDiffMode = 'triple' | 'double';

export interface BranchEntry {
    name: string;
    ref: string;
    kind: BranchKind;
    current: boolean;
    remote: string | null;
    localName: string;
    needsLocalization: boolean;
    commit: string;
}

export interface EnsureBranchResult {
    input: string;
    resolvedLocalBranch: string;
    localized: boolean;
    wasRemote: boolean;
    remoteRef: string | null;
    message?: string;
}

export interface SwitchBranchOptions {
    autoStash?: boolean;
}

export interface SwitchBranchResult {
    previousBranch: string;
    currentBranch: string;
    stashCreated: boolean;
    stashMessage: string | null;
    localizedBranch: string | null;
    messages: string[];
}

export class GitExtractor {
    private git: SimpleGit;
    private parser: DiffParser;

    constructor(repoPath: string = process.cwd()) {
        this.git = simpleGit(repoPath);
        this.parser = new DiffParser();
    }

    private normalizeBranchDiffMode(mode?: BranchDiffMode): BranchDiffMode {
        return mode === 'double' ? 'double' : 'triple';
    }

    private getBranchRange(base: string, target: string, mode?: BranchDiffMode): string {
        return this.normalizeBranchDiffMode(mode) === 'double'
            ? `${base}..${target}`
            : `${base}...${target}`;
    }

    private findBranchEntry(branchRef: string, branches: BranchEntry[]): BranchEntry | undefined {
        const trimmed = branchRef.trim();
        if (!trimmed) return undefined;

        return branches.find((branch) => {
            if (branch.name === trimmed || branch.ref === trimmed) return true;
            if (branch.kind === 'local' && `refs/heads/${branch.name}` === trimmed) return true;
            if (branch.kind === 'remote' && `refs/remotes/${branch.name}` === trimmed) return true;
            return false;
        });
    }

    /**
     * Get local uncommitted changes (working directory vs HEAD)
     */
    async getLocalDiff(options: DiffOptions = {}): Promise<ParsedDiff[]> {
        const { staged = false, context = 3 } = options;

        const args = [`-U${context}`];

        let rawDiff: string;
        if (staged) {
            rawDiff = await this.git.diff(['--cached', ...args]);
        } else {
            rawDiff = await this.git.diff(args);
        }

        return this.parser.parse(rawDiff);
    }

    /**
     * Get all local changes (both staged and unstaged)
     */
    async getAllLocalChanges(): Promise<{ staged: ParsedDiff[]; unstaged: ParsedDiff[] }> {
        const [staged, unstaged] = await Promise.all([
            this.getLocalDiff({ staged: true }),
            this.getLocalDiff({ staged: false }),
        ]);

        return { staged, unstaged };
    }

    /**
     * Get diff between two commits
     */
    async getCommitDiff(commit1: string, commit2?: string): Promise<ParsedDiff[]> {
        const range = commit2 ? `${commit1}..${commit2}` : `${commit1}^..${commit1}`;
        const rawDiff = await this.git.diff([range]);
        return this.parser.parse(rawDiff);
    }

    /**
     * Get diff between two branches
     */
    async getBranchDiff(base: string, target: string, mode?: BranchDiffMode): Promise<ParsedDiff[]> {
        const rawDiff = await this.git.diff([this.getBranchRange(base, target, mode)]);
        return this.parser.parse(rawDiff);
    }

    /**
     * Get diff for a specific file
     */
    async getFileDiff(filePath: string, commit?: string): Promise<ParsedDiff[]> {
        let rawDiff: string;
        if (commit) {
            rawDiff = await this.git.diff([`${commit}^..${commit}`, '--', filePath]);
        } else {
            rawDiff = await this.git.diff(['--', filePath]);
        }
        return this.parser.parse(rawDiff);
    }

    /**
     * Get recent commit history
     */
    async getCommitHistory(limit: number = 20): Promise<CommitInfo[]> {
        const log = await this.git.log({ maxCount: limit, '--stat': null });

        return log.all.map(commit => ({
            hash: commit.hash,
            date: commit.date,
            message: commit.message,
            author: commit.author_name,
            files: commit.diff?.files.map(f => f.file) || [],
        }));
    }

    /**
     * Get detailed branch list (local and remote)
     */
    async getBranchesDetailed(): Promise<BranchEntry[]> {
        const currentBranch = await this.getCurrentBranch().catch(() => '');
        const output = await this.git.raw([
            'for-each-ref',
            '--format=%(refname)%09%(refname:short)%09%(objectname)',
            'refs/heads',
            'refs/remotes',
        ]);

        const localBranches = new Map<string, BranchEntry>();
        const remoteBranches: BranchEntry[] = [];

        for (const line of output.split('\n')) {
            if (!line.trim()) continue;

            const [ref, shortName, commit] = line.split('\t');
            if (!ref || !shortName) continue;
            if (shortName.endsWith('/HEAD')) continue;

            if (ref.startsWith('refs/heads/')) {
                localBranches.set(shortName, {
                    name: shortName,
                    ref,
                    kind: 'local',
                    current: shortName === currentBranch,
                    remote: null,
                    localName: shortName,
                    needsLocalization: false,
                    commit: commit || '',
                });
                continue;
            }

            if (!ref.startsWith('refs/remotes/')) {
                continue;
            }

            const slashIndex = shortName.indexOf('/');
            if (slashIndex < 0) continue;

            const remote = shortName.slice(0, slashIndex);
            const localName = shortName.slice(slashIndex + 1);
            if (!localName) continue;

            remoteBranches.push({
                name: shortName,
                ref,
                kind: 'remote',
                current: false,
                remote,
                localName,
                needsLocalization: false,
                commit: commit || '',
            });
        }

        const localNames = new Set(localBranches.keys());
        const normalizedRemotes = remoteBranches.map((branch) => ({
            ...branch,
            needsLocalization: !localNames.has(branch.localName),
        }));

        const sortedLocals = [...localBranches.values()].sort((a, b) => a.name.localeCompare(b.name));
        const sortedRemotes = normalizedRemotes.sort((a, b) => a.name.localeCompare(b.name));

        return [...sortedLocals, ...sortedRemotes];
    }

    /**
     * Ensure selected branch is available locally.
     */
    async ensureLocalBranch(branchRef: string): Promise<EnsureBranchResult> {
        const branches = await this.getBranchesDetailed();
        const selected = this.findBranchEntry(branchRef, branches);

        if (!selected) {
            throw new Error(`Branch not found: ${branchRef}`);
        }

        if (selected.kind === 'local') {
            return {
                input: branchRef,
                resolvedLocalBranch: selected.name,
                localized: false,
                wasRemote: false,
                remoteRef: null,
            };
        }

        const remote = selected.remote;
        if (!remote) {
            throw new Error(`Remote name missing for branch: ${selected.name}`);
        }

        await this.git.fetch(remote, selected.localName);

        const localSet = new Set(branches.filter((b) => b.kind === 'local').map((b) => b.name));
        let localized = false;

        if (!localSet.has(selected.localName)) {
            try {
                await this.git.raw(['branch', '--track', selected.localName, `${remote}/${selected.localName}`]);
                localized = true;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (!message.includes('already exists')) {
                    throw error;
                }
            }
        }

        const action = localized ? 'created a local tracking branch' : 'resolved to local branch';
        const message = `DiffLearn fetched ${selected.name} and ${action} ${selected.localName} for comparison and learning.`;

        return {
            input: branchRef,
            resolvedLocalBranch: selected.localName,
            localized,
            wasRemote: true,
            remoteRef: selected.name,
            message,
        };
    }

    /**
     * Switch current working branch.
     */
    async switchBranch(branchRef: string, options: SwitchBranchOptions = {}): Promise<SwitchBranchResult> {
        const autoStash = options.autoStash ?? true;
        const previousBranch = await this.getCurrentBranch();
        const ensured = await this.ensureLocalBranch(branchRef);

        const messages: string[] = [];
        if (ensured.message) {
            messages.push(ensured.message);
        }

        let stashCreated = false;
        let stashMessage: string | null = null;

        if (autoStash) {
            const status = await this.git.status();
            if (!status.isClean()) {
                stashMessage = `DiffLearn auto-stash before switching to ${ensured.resolvedLocalBranch} at ${new Date().toISOString()}`;
                const output = await this.git.raw(['stash', 'push', '-u', '-m', stashMessage]);
                if (!output.includes('No local changes to save')) {
                    stashCreated = true;
                    messages.push(`Created stash: ${stashMessage}`);
                }
            }
        }

        await this.git.checkout(ensured.resolvedLocalBranch);
        const currentBranch = await this.getCurrentBranch();
        messages.push(`Switched from ${previousBranch} to ${currentBranch}.`);

        return {
            previousBranch,
            currentBranch,
            stashCreated,
            stashMessage,
            localizedBranch: ensured.localized ? ensured.resolvedLocalBranch : null,
            messages,
        };
    }

    /**
     * Get list of local branches
     */
    async getBranches(): Promise<BranchInfo[]> {
        const branches = await this.git.branchLocal();

        return branches.all.map(name => ({
            name,
            current: name === branches.current,
            commit: branches.branches[name]?.commit || '',
        }));
    }

    /**
     * Get current branch name
     */
    async getCurrentBranch(): Promise<string> {
        const branches = await this.git.branch();
        return branches.current;
    }

    /**
     * Check if directory is a git repository
     */
    async isRepo(): Promise<boolean> {
        try {
            await this.git.status();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get raw diff string (for direct LLM consumption)
     */
    async getRawDiff(type: 'local' | 'staged' | 'commit' | 'branch', options?: {
        commit1?: string;
        commit2?: string;
        branch1?: string;
        branch2?: string;
        branchMode?: BranchDiffMode;
    }): Promise<string> {
        switch (type) {
            case 'local':
                return this.git.diff();
            case 'staged':
                return this.git.diff(['--cached']);
            case 'commit':
                if (!options?.commit1) throw new Error('commit1 is required');
                const range = options.commit2
                    ? `${options.commit1}..${options.commit2}`
                    : `${options.commit1}^..${options.commit1}`;
                return this.git.diff([range]);
            case 'branch':
                if (!options?.branch1 || !options?.branch2) {
                    throw new Error('branch1 and branch2 are required');
                }
                return this.git.diff([this.getBranchRange(options.branch1, options.branch2, options.branchMode)]);
            default:
                throw new Error(`Unknown diff type: ${type}`);
        }
    }
}
