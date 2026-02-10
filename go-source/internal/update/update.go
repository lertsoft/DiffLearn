package update

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
)

const githubRepo = "lertsoft/DiffLearn"

func GetCurrentVersion() string {
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return "0.3.0"
}

type UpdateInfo struct {
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	UpdateAvailable bool  `json:"updateAvailable"`
	ReleaseURL     string `json:"releaseUrl"`
	PublishedAt    string `json:"publishedAt,omitempty"`
}

func CheckForUpdates() (*UpdateInfo, error) {
	req, _ := http.NewRequest(http.MethodGet, "https://api.github.com/repos/"+githubRepo+"/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "DiffLearn-Go")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("github status: %d", resp.StatusCode)
	}
	var p struct {
		TagName     string `json:"tag_name"`
		HTMLURL     string `json:"html_url"`
		PublishedAt string `json:"published_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return nil, err
	}
	latest := strings.TrimPrefix(p.TagName, "v")
	current := GetCurrentVersion()
	return &UpdateInfo{CurrentVersion: current, LatestVersion: latest, UpdateAvailable: compareVersions(latest, current) > 0, ReleaseURL: p.HTMLURL, PublishedAt: p.PublishedAt}, nil
}

func compareVersions(v1, v2 string) int {
	var a1, b1, c1 int
	var a2, b2, c2 int
	fmt.Sscanf(v1, "%d.%d.%d", &a1, &b1, &c1)
	fmt.Sscanf(v2, "%d.%d.%d", &a2, &b2, &c2)
	if a1 != a2 {
		if a1 > a2 { return 1 }
		return -1
	}
	if b1 != b2 {
		if b1 > b2 { return 1 }
		return -1
	}
	if c1 != c2 {
		if c1 > c2 { return 1 }
		return -1
	}
	return 0
}

func GetUpdateCommand() string {
	exe := os.Args[0]
	if strings.HasSuffix(exe, ".go") {
		wd, _ := os.Getwd()
		return fmt.Sprintf("cd %s && git pull", filepath.Clean(wd))
	}
	return fmt.Sprintf("curl -fsSL https://raw.githubusercontent.com/%s/master/install.sh | bash", githubRepo)
}
