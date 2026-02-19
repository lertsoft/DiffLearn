export {
    GitExtractor,
    type DiffOptions,
    type CommitInfo,
    type BranchInfo,
    type BranchKind,
    type BranchDiffMode,
    type BranchEntry,
    type EnsureBranchResult,
    type SwitchBranchOptions,
    type SwitchBranchResult,
} from './extractor';
export { DiffParser, type ParsedDiff, type ParsedHunk, type ParsedLine, type DiffStats } from './parser';
export { DiffFormatter, type OutputFormat, type FormatterOptions } from './formatter';
