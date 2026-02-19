package cli

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"difflearn-go/internal/git"
)

type section string

const (
	secLocal   section = "local"
	secStaged  section = "staged"
	secHistory section = "history"
)

type dashboardModel struct {
	repoPath      string
	section       section
	localDiffs    []git.ParsedDiff
	stagedDiffs   []git.ParsedDiff
	commits       []git.CommitInfo
	historyIndex  int
	status        string
	loading       bool
	selectedDiffs []git.ParsedDiff
}

type loadedMsg struct {
	local   []git.ParsedDiff
	staged  []git.ParsedDiff
	commits []git.CommitInfo
	err     error
}

type commitDiffMsg struct {
	diffs []git.ParsedDiff
	err   error
}

func RunDashboard(repoPath string) error {
	m := dashboardModel{repoPath: repoPath, section: secLocal, loading: true, status: "Loading..."}
	p := tea.NewProgram(m, tea.WithAltScreen())
	_, err := p.Run()
	return err
}

func RunCommitView(repoPath, c1, c2 string) error {
	g := git.NewGitExtractor(repoPath)
	diffs, err := g.GetCommitDiff(c1, c2)
	if err != nil {
		return err
	}
	fmt.Println(git.NewDiffFormatter().ToTerminal(diffs, git.FormatterOptions{}))
	return nil
}

func RunBranchView(repoPath, b1, b2 string) error {
	g := git.NewGitExtractor(repoPath)
	diffs, err := g.GetBranchDiff(b1, b2)
	if err != nil {
		return err
	}
	fmt.Println(git.NewDiffFormatter().ToTerminal(diffs, git.FormatterOptions{}))
	return nil
}

func (m dashboardModel) Init() tea.Cmd {
	return m.loadAllCmd()
}

func (m dashboardModel) loadAllCmd() tea.Cmd {
	return func() tea.Msg {
		g := git.NewGitExtractor(m.repoPath)
		if !g.IsRepo() {
			return loadedMsg{err: fmt.Errorf("not a git repository")}
		}
		local, err := g.GetLocalDiff(git.DiffOptions{})
		if err != nil {
			return loadedMsg{err: err}
		}
		staged, err := g.GetLocalDiff(git.DiffOptions{Staged: true})
		if err != nil {
			return loadedMsg{err: err}
		}
		commits, err := g.GetCommitHistory(50)
		if err != nil {
			return loadedMsg{err: err}
		}
		return loadedMsg{local: local, staged: staged, commits: commits}
	}
}

func (m dashboardModel) loadCommitDiffCmd(hash string) tea.Cmd {
	return func() tea.Msg {
		g := git.NewGitExtractor(m.repoPath)
		diffs, err := g.GetCommitDiff(hash, "")
		return commitDiffMsg{diffs: diffs, err: err}
	}
}

func (m dashboardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, tea.Quit
		case "tab":
			if m.section == secLocal {
				m.section = secStaged
				m.selectedDiffs = m.stagedDiffs
				m.status = "Staged changes"
			} else if m.section == secStaged {
				m.section = secHistory
				m.selectedDiffs = nil
				m.status = "History view"
			} else {
				m.section = secLocal
				m.selectedDiffs = m.localDiffs
				m.status = "Local changes"
			}
		case "r":
			m.loading = true
			m.status = "Refreshing..."
			return m, m.loadAllCmd()
		case "up", "k", "w":
			if m.section == secHistory && m.historyIndex > 0 {
				m.historyIndex--
			}
		case "down", "j", "s":
			if m.section == secHistory && m.historyIndex < len(m.commits)-1 {
				m.historyIndex++
			}
		case "enter":
			if m.section == secHistory && len(m.commits) > 0 {
				m.loading = true
				m.status = "Loading commit diff..."
				return m, m.loadCommitDiffCmd(m.commits[m.historyIndex].Hash)
			}
		}
	case loadedMsg:
		m.loading = false
		if msg.err != nil {
			m.status = "Error: " + msg.err.Error()
			return m, nil
		}
		m.localDiffs = msg.local
		m.stagedDiffs = msg.staged
		m.commits = msg.commits
		m.selectedDiffs = msg.local
		m.status = "Loaded"
	case commitDiffMsg:
		m.loading = false
		if msg.err != nil {
			m.status = "Error: " + msg.err.Error()
			return m, nil
		}
		m.selectedDiffs = msg.diffs
		m.section = secHistory
		m.status = "Showing selected commit diff"
	}
	return m, nil
}

func (m dashboardModel) View() string {
	header := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("13")).Render("🔍 DiffLearn")
	tabs := []string{"Local", "Staged", "History"}
	active := map[section]int{secLocal: 0, secStaged: 1, secHistory: 2}[m.section]
	for i := range tabs {
		if i == active {
			tabs[i] = lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true).Render(tabs[i])
		}
	}
	line := strings.Join(tabs, " | ")
	status := lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(m.status + " • q quit • Tab switch • Enter select • r refresh")

	if m.loading {
		return fmt.Sprintf("%s\n%s\n\nLoading...\n\n%s", header, line, status)
	}

	body := ""
	if m.section == secHistory {
		if len(m.commits) == 0 {
			body = "No commits found"
		} else {
			rows := make([]string, 0, len(m.commits))
			for i, c := range m.commits {
				prefix := "  "
				if i == m.historyIndex {
					prefix = "> "
				}
				rows = append(rows, fmt.Sprintf("%s%s %s (%s)", prefix, short(c.Hash, 7), c.Message, c.Author))
			}
			body = strings.Join(rows, "\n")
		}
	} else {
		if len(m.selectedDiffs) == 0 {
			body = "No changes found"
		} else {
			body = git.NewDiffFormatter().ToTerminal(m.selectedDiffs, git.FormatterOptions{})
		}
	}
	return fmt.Sprintf("%s\n%s\n\n%s\n\n%s", header, line, body, status)
}
