package cli

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"time"

	"github.com/fatih/color"
	"github.com/spf13/cobra"

	"difflearn-go/internal/api"
	"difflearn-go/internal/config"
	"difflearn-go/internal/git"
	"difflearn-go/internal/llm"
	"difflearn-go/internal/mcp"
	"difflearn-go/internal/update"
)

func NewRootCmd() *cobra.Command {
	var repoPath string
	root := &cobra.Command{
		Use:     "difflearn",
		Short:   "Interactive git diff learning tool with LLM-powered explanations",
		Version: "0.3.0-go",
		RunE: func(cmd *cobra.Command, args []string) error {
			return RunDashboard(repoPath)
		},
	}
	root.PersistentFlags().StringVar(&repoPath, "repo", ".", "Repository path")

	root.AddCommand(localCmd(&repoPath))
	root.AddCommand(commitCmd(&repoPath))
	root.AddCommand(branchCmd(&repoPath))
	root.AddCommand(explainCmd(&repoPath))
	root.AddCommand(reviewCmd(&repoPath))
	root.AddCommand(summaryCmd(&repoPath))
	root.AddCommand(exportCmd(&repoPath))
	root.AddCommand(historyCmd(&repoPath))
	root.AddCommand(webCmd(&repoPath))
	root.AddCommand(configCmd())
	root.AddCommand(mcpCmd(&repoPath))
	root.AddCommand(updateCmd())

	return root
}

func Execute() error { return NewRootCmd().Execute() }

func localCmd(repoPath *string) *cobra.Command {
	var staged bool
	var noInteractive bool
	cmd := &cobra.Command{
		Use:   "local",
		Short: "View local uncommitted changes interactively",
		RunE: func(cmd *cobra.Command, args []string) error {
			if !noInteractive {
				return RunDashboard(*repoPath)
			}
			g := git.NewGitExtractor(*repoPath)
			formatter := git.NewDiffFormatter()
			diffs, err := g.GetLocalDiff(git.DiffOptions{Staged: staged})
			if err != nil {
				return err
			}
			fmt.Println(formatter.ToTerminal(diffs, git.FormatterOptions{}))
			return nil
		},
	}
	cmd.Flags().BoolVarP(&staged, "staged", "s", false, "View only staged changes")
	cmd.Flags().BoolVar(&noInteractive, "no-interactive", false, "Print diff without interactive mode")
	return cmd
}

func commitCmd(repoPath *string) *cobra.Command {
	var compare string
	var noInteractive bool
	cmd := &cobra.Command{
		Use:   "commit <sha>",
		Short: "View changes in a specific commit",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !noInteractive {
				return RunCommitView(*repoPath, args[0], compare)
			}
			g := git.NewGitExtractor(*repoPath)
			diffs, err := g.GetCommitDiff(args[0], compare)
			if err != nil {
				return err
			}
			fmt.Println(git.NewDiffFormatter().ToTerminal(diffs, git.FormatterOptions{}))
			return nil
		},
	}
	cmd.Flags().StringVarP(&compare, "compare", "c", "", "Compare with another commit")
	cmd.Flags().BoolVar(&noInteractive, "no-interactive", false, "Print diff without interactive mode")
	return cmd
}

func branchCmd(repoPath *string) *cobra.Command {
	var noInteractive bool
	cmd := &cobra.Command{
		Use:   "branch <branch1> <branch2>",
		Short: "Compare two branches",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			if !noInteractive {
				return RunBranchView(*repoPath, args[0], args[1])
			}
			g := git.NewGitExtractor(*repoPath)
			diffs, err := g.GetBranchDiff(args[0], args[1])
			if err != nil {
				return err
			}
			fmt.Println(git.NewDiffFormatter().ToTerminal(diffs, git.FormatterOptions{}))
			return nil
		},
	}
	cmd.Flags().BoolVar(&noInteractive, "no-interactive", false, "Print diff without interactive mode")
	return cmd
}

func explainCmd(repoPath *string) *cobra.Command {
	var staged bool
	cmd := &cobra.Command{
		Use:   "explain",
		Short: "Get an AI explanation of local changes",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runLLMCommand(*repoPath, staged, "explain")
		},
	}
	cmd.Flags().BoolVarP(&staged, "staged", "s", false, "Explain only staged changes")
	return cmd
}

func reviewCmd(repoPath *string) *cobra.Command {
	var staged bool
	cmd := &cobra.Command{
		Use:   "review",
		Short: "Get an AI code review of local changes",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runLLMCommand(*repoPath, staged, "review")
		},
	}
	cmd.Flags().BoolVarP(&staged, "staged", "s", false, "Review only staged changes")
	return cmd
}

func summaryCmd(repoPath *string) *cobra.Command {
	var staged bool
	cmd := &cobra.Command{
		Use:   "summary",
		Short: "Get a quick summary of changes",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runLLMCommand(*repoPath, staged, "summary")
		},
	}
	cmd.Flags().BoolVarP(&staged, "staged", "s", false, "Summarize only staged changes")
	return cmd
}

func exportCmd(repoPath *string) *cobra.Command {
	var staged bool
	var format string
	cmd := &cobra.Command{
		Use:   "export",
		Short: "Export diff in various formats",
		RunE: func(cmd *cobra.Command, args []string) error {
			g := git.NewGitExtractor(*repoPath)
			formatter := git.NewDiffFormatter()
			diffs, err := g.GetLocalDiff(git.DiffOptions{Staged: staged})
			if err != nil {
				return err
			}
			switch format {
			case "json":
				fmt.Println(formatter.ToJSON(diffs))
			case "terminal":
				fmt.Println(formatter.ToTerminal(diffs, git.FormatterOptions{}))
			default:
				fmt.Println(formatter.ToMarkdown(diffs))
			}
			return nil
		},
	}
	cmd.Flags().StringVarP(&format, "format", "f", "markdown", "Output format: json, markdown, terminal")
	cmd.Flags().BoolVarP(&staged, "staged", "s", false, "Export only staged changes")
	return cmd
}

func historyCmd(repoPath *string) *cobra.Command {
	var number int
	cmd := &cobra.Command{
		Use:   "history",
		Short: "List recent commits",
		RunE: func(cmd *cobra.Command, args []string) error {
			g := git.NewGitExtractor(*repoPath)
			commits, err := g.GetCommitHistory(number)
			if err != nil {
				return err
			}
			for _, c := range commits {
				t, _ := time.Parse(time.RFC3339, c.Date)
				fmt.Printf("%s %s %s (%s)\n", color.YellowString(short(c.Hash, 7)), color.HiBlackString(t.Format("2006-01-02")), c.Message, color.HiBlackString(c.Author))
			}
			return nil
		},
	}
	cmd.Flags().IntVarP(&number, "number", "n", 10, "Number of commits to show")
	return cmd
}

func webCmd(repoPath *string) *cobra.Command {
	var port int
	cmd := &cobra.Command{
		Use:   "web",
		Short: "Launch the web UI in your browser",
		RunE: func(cmd *cobra.Command, args []string) error {
			go func() { _ = openBrowser(fmt.Sprintf("http://localhost:%d", port)) }()
			return api.StartAPIServer(port, *repoPath)
		},
	}
	cmd.Flags().IntVarP(&port, "port", "p", 3000, "Port for web server")
	return cmd
}

func configCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "config",
		Short: "Show LLM configuration status",
		Run: func(cmd *cobra.Command, args []string) {
			cfg := config.LoadConfig()
			fmt.Printf("Provider: %s\n", cfg.Provider)
			fmt.Printf("Model: %s\n", cfg.Model)
			fmt.Printf("LLM Available: %t\n", config.IsLLMAvailable(cfg))
			if cfg.BaseURL != "" {
				fmt.Printf("Base URL: %s\n", cfg.BaseURL)
			}
		},
	}
	return cmd
}

func mcpCmd(repoPath *string) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "serve-mcp",
		Short: "Run MCP server over stdio",
		RunE: func(cmd *cobra.Command, args []string) error {
			return mcp.Serve(*repoPath)
		},
	}
	return cmd
}

func updateCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "update",
		Short: "Check for updates",
		RunE: func(cmd *cobra.Command, args []string) error {
			info, err := update.CheckForUpdates()
			if err != nil {
				return err
			}
			if info == nil || !info.UpdateAvailable {
				fmt.Println("✅ You're on the latest version")
				return nil
			}
			fmt.Printf("🆕 Update available: v%s -> v%s\n", info.CurrentVersion, info.LatestVersion)
			fmt.Printf("Run: %s\n", update.GetUpdateCommand())
			fmt.Printf("Release: %s\n", info.ReleaseURL)
			return nil
		},
	}
	return cmd
}

func runLLMCommand(repoPath string, staged bool, kind string) error {
	cfg := config.LoadConfig()
	g := git.NewGitExtractor(repoPath)
	formatter := git.NewDiffFormatter()
	diffs, err := g.GetLocalDiff(git.DiffOptions{Staged: staged})
	if err != nil {
		return err
	}
	if len(diffs) == 0 {
		fmt.Println(color.YellowString("No changes found."))
		return nil
	}
	if !config.IsLLMAvailable(cfg) {
		fmt.Println(color.YellowString("No LLM API key configured."))
		switch kind {
		case "explain":
			fmt.Println(llm.CreateExplainPrompt(formatter, diffs))
		case "review":
			fmt.Println(llm.CreateReviewPrompt(formatter, diffs))
		case "summary":
			fmt.Println(formatter.ToSummary(diffs))
		}
		return nil
	}
	client := llm.NewClient(cfg)
	prompt := ""
	label := ""
	switch kind {
	case "explain":
		prompt = llm.CreateExplainPrompt(formatter, diffs)
		label = "Explanation"
	case "review":
		prompt = llm.CreateReviewPrompt(formatter, diffs)
		label = "Code Review"
	case "summary":
		prompt = llm.CreateSummaryPrompt(formatter, diffs)
		label = "Summary"
	}
	fmt.Printf("%s\n\n", color.GreenString("📝 "+label+":"))
	chunks, errs := client.StreamChat([]llm.ChatMessage{{Role: "system", Content: llm.SystemPrompt}, {Role: "user", Content: prompt}})
	for c := range chunks {
		fmt.Print(c)
	}
	if err := <-errs; err != nil {
		return err
	}
	fmt.Println()
	return nil
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}

func short(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func atoiOrDefault(s string, d int) int {
	v, err := strconv.Atoi(s)
	if err != nil {
		return d
	}
	return v
}

func PrintErrAndExit(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
