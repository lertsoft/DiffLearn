/**
 * Tests for the Update module
 */
import { describe, test, expect } from 'bun:test';
import {
    getCurrentVersion,
    getInstallationType,
    getUpdateCommand,
    formatUpdateMessage,
    UpdateInfo,
} from '../src/update';

describe('Update Module', () => {
    describe('getCurrentVersion()', () => {
        test('should return a version string', () => {
            const version = getCurrentVersion();
            expect(typeof version).toBe('string');
            expect(version).toMatch(/^\d+\.\d+\.\d+/);
        });

        test('should return a valid semver format', () => {
            const version = getCurrentVersion();
            const parts = version.split('.');
            expect(parts.length).toBeGreaterThanOrEqual(3);
            expect(Number(parts[0])).toBeGreaterThanOrEqual(0);
        });
    });

    describe('getInstallationType()', () => {
        test('should return either "binary" or "source"', () => {
            const type = getInstallationType();
            expect(['binary', 'source']).toContain(type);
        });

        test('should return "source" when running from .ts or .tsx file', () => {
            // When running tests with bun, we're running from source
            const type = getInstallationType();
            expect(type).toBe('source');
        });
    });

    describe('getUpdateCommand()', () => {
        test('should return a command string', () => {
            const cmd = getUpdateCommand();
            expect(typeof cmd).toBe('string');
            expect(cmd.length).toBeGreaterThan(0);
        });

        test('should include git pull for source installs', () => {
            // Running tests = source install
            const cmd = getUpdateCommand();
            expect(cmd).toContain('git pull');
        });
    });

    describe('formatUpdateMessage()', () => {
        test('should show "latest version" when no update available', () => {
            const info: UpdateInfo = {
                currentVersion: '1.0.0',
                latestVersion: '1.0.0',
                updateAvailable: false,
                releaseUrl: 'https://github.com/test/repo',
            };

            const message = formatUpdateMessage(info);
            expect(message).toContain('latest version');
            expect(message).toContain('1.0.0');
        });

        test('should show update instructions when update available', () => {
            const info: UpdateInfo = {
                currentVersion: '1.0.0',
                latestVersion: '2.0.0',
                updateAvailable: true,
                releaseUrl: 'https://github.com/test/repo/releases/v2.0.0',
            };

            const message = formatUpdateMessage(info);
            expect(message).toContain('Update available');
            expect(message).toContain('1.0.0');
            expect(message).toContain('2.0.0');
            expect(message).toContain('Release:');
        });

        test('should include published date when available', () => {
            const info: UpdateInfo = {
                currentVersion: '1.0.0',
                latestVersion: '2.0.0',
                updateAvailable: true,
                releaseUrl: 'https://github.com/test/repo',
                publishedAt: '2024-01-15T12:00:00Z',
            };

            const message = formatUpdateMessage(info);
            expect(message).toContain('Published');
        });
    });
});
