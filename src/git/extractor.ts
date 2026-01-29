import { simpleGit, SimpleGit, DiffResult } from 'simple-git';
import { DiffParser, ParsedDiff, ParsedHunk, ParsedLine } from './parser';

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

export class GitExtractor {
    private git: SimpleGit;
    private parser: DiffParser;

    constructor(repoPath: string = process.cwd()) {
        this.git = simpleGit(repoPath);
        this.parser = new DiffParser();
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
    async getBranchDiff(branch1: string, branch2: string): Promise<ParsedDiff[]> {
        const rawDiff = await this.git.diff([`${branch1}...${branch2}`]);
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
     * Get list of branches
     */
    async getBranches(): Promise<BranchInfo[]> {
        const branches = await this.git.branch();

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
                return this.git.diff([`${options.branch1}...${options.branch2}`]);
            default:
                throw new Error(`Unknown diff type: ${type}`);
        }
    }
}
