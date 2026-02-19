package git

type ParsedLineType string

const (
	LineAdd     ParsedLineType = "add"
	LineDelete  ParsedLineType = "delete"
	LineContext ParsedLineType = "context"
)

type ParsedLine struct {
	Type          ParsedLineType `json:"type"`
	Content       string         `json:"content"`
	OldLineNumber *int           `json:"oldLineNumber,omitempty"`
	NewLineNumber *int           `json:"newLineNumber,omitempty"`
}

type ParsedHunk struct {
	OldStart int          `json:"oldStart"`
	OldLines int          `json:"oldLines"`
	NewStart int          `json:"newStart"`
	NewLines int          `json:"newLines"`
	Header   string       `json:"header"`
	Lines    []ParsedLine `json:"lines"`
}

type ParsedDiff struct {
	OldFile   string       `json:"oldFile"`
	NewFile   string       `json:"newFile"`
	Hunks     []ParsedHunk `json:"hunks"`
	IsBinary  bool         `json:"isBinary"`
	IsNew     bool         `json:"isNew"`
	IsDeleted bool         `json:"isDeleted"`
	IsRenamed bool         `json:"isRenamed"`
	Additions int          `json:"additions"`
	Deletions int          `json:"deletions"`
}

type DiffStats struct {
	Files     int `json:"files"`
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
}

type CommitInfo struct {
	Hash    string   `json:"hash"`
	Date    string   `json:"date"`
	Message string   `json:"message"`
	Author  string   `json:"author"`
	Files   []string `json:"files"`
}

type BranchInfo struct {
	Name    string `json:"name"`
	Current bool   `json:"current"`
	Commit  string `json:"commit"`
}

type BranchKind string

const (
	BranchKindLocal  BranchKind = "local"
	BranchKindRemote BranchKind = "remote"
)

type BranchDiffMode string

const (
	BranchModeTriple BranchDiffMode = "triple"
	BranchModeDouble BranchDiffMode = "double"
)

type BranchEntry struct {
	Name              string     `json:"name"`
	Ref               string     `json:"ref"`
	Kind              BranchKind `json:"kind"`
	Current           bool       `json:"current"`
	Remote            *string    `json:"remote"`
	LocalName         string     `json:"localName"`
	NeedsLocalization bool       `json:"needsLocalization"`
	Commit            string     `json:"commit"`
}

type EnsureBranchResult struct {
	Input               string  `json:"input"`
	ResolvedLocalBranch string  `json:"resolvedLocalBranch"`
	Localized           bool    `json:"localized"`
	WasRemote           bool    `json:"wasRemote"`
	RemoteRef           *string `json:"remoteRef"`
	Message             string  `json:"message,omitempty"`
}

type SwitchBranchOptions struct {
	AutoStash bool `json:"autoStash"`
}

type SwitchBranchResult struct {
	PreviousBranch  string   `json:"previousBranch"`
	CurrentBranch   string   `json:"currentBranch"`
	StashCreated    bool     `json:"stashCreated"`
	StashMessage    *string  `json:"stashMessage"`
	LocalizedBranch *string  `json:"localizedBranch"`
	Messages        []string `json:"messages"`
}
