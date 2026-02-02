import { describe, it, expect } from 'vitest';
import { isBlockedSystemDirectory, createBlockedDirectoryError } from './blocked-dirs.js';

describe('isBlockedSystemDirectory', () => {
    describe('Linux paths', () => {
        it.skipIf(process.platform === 'win32')('blocks /etc', () => {
            expect(isBlockedSystemDirectory('/etc')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks /etc subdirectories', () => {
            expect(isBlockedSystemDirectory('/etc/nginx')).toBe(true);
            expect(isBlockedSystemDirectory('/etc/nginx/conf.d')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks /proc', () => {
            expect(isBlockedSystemDirectory('/proc')).toBe(true);
            expect(isBlockedSystemDirectory('/proc/1')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks /sys', () => {
            expect(isBlockedSystemDirectory('/sys')).toBe(true);
            expect(isBlockedSystemDirectory('/sys/class')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks /dev', () => {
            expect(isBlockedSystemDirectory('/dev')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks /boot', () => {
            expect(isBlockedSystemDirectory('/boot')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks /root', () => {
            expect(isBlockedSystemDirectory('/root')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks system binary directories', () => {
            expect(isBlockedSystemDirectory('/bin')).toBe(true);
            expect(isBlockedSystemDirectory('/sbin')).toBe(true);
            expect(isBlockedSystemDirectory('/usr/bin')).toBe(true);
            expect(isBlockedSystemDirectory('/usr/sbin')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks library directories', () => {
            expect(isBlockedSystemDirectory('/lib')).toBe(true);
            expect(isBlockedSystemDirectory('/lib64')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('blocks runtime directories', () => {
            expect(isBlockedSystemDirectory('/var/run')).toBe(true);
            expect(isBlockedSystemDirectory('/run')).toBe(true);
        });

        it.skipIf(process.platform === 'win32')('allows /tmp', () => {
            expect(isBlockedSystemDirectory('/tmp')).toBe(false);
        });

        it.skipIf(process.platform === 'win32')('allows /home/user directories', () => {
            expect(isBlockedSystemDirectory('/home/user')).toBe(false);
            expect(isBlockedSystemDirectory('/home/user/downloads')).toBe(false);
        });

        it.skipIf(process.platform === 'win32')('allows /var/tmp', () => {
            expect(isBlockedSystemDirectory('/var/tmp')).toBe(false);
        });

        it.skipIf(process.platform === 'win32')('does not match partial directory names', () => {
            // /etcfiles should not match /etc
            expect(isBlockedSystemDirectory('/etcfiles')).toBe(false);
            // /system should not match /sys
            expect(isBlockedSystemDirectory('/system')).toBe(false);
        });
    });

    describe('macOS paths', () => {
        it.skipIf(process.platform !== 'darwin')('blocks /System', () => {
            expect(isBlockedSystemDirectory('/System')).toBe(true);
            expect(isBlockedSystemDirectory('/System/Library')).toBe(true);
        });

        it.skipIf(process.platform !== 'darwin')('blocks /Library', () => {
            expect(isBlockedSystemDirectory('/Library')).toBe(true);
            expect(isBlockedSystemDirectory('/Library/Preferences')).toBe(true);
        });

        it.skipIf(process.platform !== 'darwin')('blocks /private/etc and /private/var', () => {
            expect(isBlockedSystemDirectory('/private/etc')).toBe(true);
            expect(isBlockedSystemDirectory('/private/var')).toBe(true);
        });

        it.skipIf(process.platform !== 'darwin')('blocks /cores', () => {
            expect(isBlockedSystemDirectory('/cores')).toBe(true);
        });

        it.skipIf(process.platform !== 'darwin')('blocks /Volumes root but allows subdirectories', () => {
            expect(isBlockedSystemDirectory('/Volumes')).toBe(true);
            expect(isBlockedSystemDirectory('/Volumes/MyDrive')).toBe(false);
            expect(isBlockedSystemDirectory('/Volumes/MyDrive/projects')).toBe(false);
        });

        it.skipIf(process.platform !== 'darwin')('allows /Users directories', () => {
            expect(isBlockedSystemDirectory('/Users/testuser')).toBe(false);
            expect(isBlockedSystemDirectory('/Users/testuser/Downloads')).toBe(false);
        });

        it.skipIf(process.platform !== 'darwin')('allows /tmp on macOS', () => {
            expect(isBlockedSystemDirectory('/tmp')).toBe(false);
        });
    });

    describe('Windows paths', () => {
        it.skipIf(process.platform !== 'win32')('blocks C:\\Windows', () => {
            expect(isBlockedSystemDirectory('C:\\Windows')).toBe(true);
            expect(isBlockedSystemDirectory('C:\\Windows\\System32')).toBe(true);
        });

        it.skipIf(process.platform !== 'win32')('blocks Windows directory case-insensitively', () => {
            expect(isBlockedSystemDirectory('c:\\windows')).toBe(true);
            expect(isBlockedSystemDirectory('C:\\WINDOWS')).toBe(true);
        });

        it.skipIf(process.platform !== 'win32')('blocks Program Files directories', () => {
            expect(isBlockedSystemDirectory('C:\\Program Files')).toBe(true);
            expect(isBlockedSystemDirectory('C:\\Program Files (x86)')).toBe(true);
            expect(isBlockedSystemDirectory('C:\\Program Files\\App')).toBe(true);
        });

        it.skipIf(process.platform !== 'win32')('blocks ProgramData', () => {
            expect(isBlockedSystemDirectory('C:\\ProgramData')).toBe(true);
        });

        it.skipIf(process.platform !== 'win32')('blocks other drive letters', () => {
            expect(isBlockedSystemDirectory('D:\\Windows')).toBe(true);
            expect(isBlockedSystemDirectory('E:\\Program Files')).toBe(true);
        });

        it.skipIf(process.platform !== 'win32')('allows C:\\Users directories', () => {
            expect(isBlockedSystemDirectory('C:\\Users\\testuser')).toBe(false);
            expect(isBlockedSystemDirectory('C:\\Users\\testuser\\Downloads')).toBe(false);
        });

        it.skipIf(process.platform !== 'win32')('allows non-system directories', () => {
            expect(isBlockedSystemDirectory('C:\\Projects')).toBe(false);
            expect(isBlockedSystemDirectory('D:\\Data')).toBe(false);
        });
    });
});

describe('createBlockedDirectoryError', () => {
    it('creates error with single path when original equals resolved', () => {
        const error = createBlockedDirectoryError('/etc', '/etc');
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('"/etc"');
        expect(error.message).not.toContain('resolves to');
        expect(error.message).toContain('writing to system directories is not allowed');
    });

    it('creates error with both paths when they differ (symlink case)', () => {
        const error = createBlockedDirectoryError('/tmp/safe', '/etc');
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('"/tmp/safe"');
        expect(error.message).toContain('resolves to "/etc"');
        expect(error.message).toContain('writing to system directories is not allowed');
    });

    it('suggests user-writable alternatives', () => {
        const error = createBlockedDirectoryError('/etc', '/etc');
        expect(error.message).toContain('~/downloads');
        expect(error.message).toContain('project directory');
    });
});
