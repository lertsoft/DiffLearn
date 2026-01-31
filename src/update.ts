/**
 * Update checking module for DiffLearn
 * Checks GitHub releases for new versions and provides update instructions
 */

import * as fs from 'fs';
import * as path from 'path';

const GITHUB_REPO = 'lertsoft/DiffLearn';
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface UpdateInfo {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    releaseUrl: string;
    releaseNotes?: string;
    publishedAt?: string;
}

/**
 * Get the current version from package.json
 */
export function getCurrentVersion(): string {
    try {
        // Try to find package.json relative to this file or in common locations
        const possiblePaths = [
            path.join(__dirname, '../package.json'),
            path.join(__dirname, '../../package.json'),
            path.join(process.cwd(), 'package.json'),
        ];

        for (const pkgPath of possiblePaths) {
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                return pkg.version || '0.0.0';
            }
        }

        return '0.1.0'; // Fallback to known version
    } catch (_error: unknown) {
        return '0.1.0';
    }
}

/**
 * Fetch the latest release info from GitHub
 */
export async function getLatestRelease(): Promise<{
    version: string;
    url: string;
    notes?: string;
    publishedAt?: string;
} | null> {
    try {
        const response = await fetch(GITHUB_API_URL, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'DiffLearn-Update-Checker',
            },
        });

        if (!response.ok) {
            // No releases yet or rate limited
            return null;
        }

        const data = await response.json() as {
            tag_name?: string;
            html_url?: string;
            body?: string;
            published_at?: string;
        };

        // Tag name is usually "v0.1.0" format, strip the 'v' prefix
        const version = (data.tag_name || '').replace(/^v/, '');

        return {
            version,
            url: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
            notes: data.body,
            publishedAt: data.published_at,
        };
    } catch (_error: unknown) {
        // Network error or parsing error
        return null;
    }
}

/**
 * Compare two semver versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;

        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }

    return 0;
}

/**
 * Check for updates and return update info
 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
    const currentVersion = getCurrentVersion();
    const latest = await getLatestRelease();

    if (!latest || !latest.version) {
        return null;
    }

    const updateAvailable = compareVersions(latest.version, currentVersion) > 0;

    return {
        currentVersion,
        latestVersion: latest.version,
        updateAvailable,
        releaseUrl: latest.url,
        releaseNotes: latest.notes,
        publishedAt: latest.publishedAt,
    };
}

/**
 * Determine if running from binary or source installation
 */
export function getInstallationType(): 'binary' | 'source' {
    // If we're running as a compiled binary, Bun.main will be the binary itself
    // For source installs, it will be the .tsx file
    const mainFile = process.argv[1] || '';

    if (mainFile.endsWith('.tsx') || mainFile.endsWith('.ts')) {
        return 'source';
    }

    return 'binary';
}

/**
 * Get the git root directory for source installations
 */
function getGitRoot(): string {
    try {
        // Look for package.json relative to this module
        const possibleRoots = [
            path.join(__dirname, '..'),
            path.join(__dirname, '../..'),
            process.cwd(),
        ];

        for (const root of possibleRoots) {
            if (fs.existsSync(path.join(root, 'package.json'))) {
                return root;
            }
        }
    } catch (_error: unknown) {
        // Fall through to default
    }
    return process.cwd();
}

/**
 * Get the appropriate update command based on installation type
 */
export function getUpdateCommand(): string {
    const installType = getInstallationType();

    if (installType === 'binary') {
        return `curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/master/install.sh | bash`;
    }

    // Source installation - use git pull from git root
    const gitRoot = getGitRoot();
    return `cd ${gitRoot} && git pull && bun install`;
}

/**
 * Format update info for display
 */
export function formatUpdateMessage(info: UpdateInfo): string {
    if (!info.updateAvailable) {
        return `✅ You're on the latest version (v${info.currentVersion})`;
    }

    const installType = getInstallationType();
    const updateCmd = getUpdateCommand();

    let message = `🆕 Update available: v${info.currentVersion} → v${info.latestVersion}\n\n`;

    if (installType === 'binary') {
        message += `To update, run:\n  ${updateCmd}\n`;
    } else {
        message += `To update (source install):\n  git pull && bun install\n`;
    }

    message += `\n📋 Release: ${info.releaseUrl}`;

    if (info.publishedAt) {
        const date = new Date(info.publishedAt).toLocaleDateString();
        message += `\n📅 Published: ${date}`;
    }

    return message;
}
