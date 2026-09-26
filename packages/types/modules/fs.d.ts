/**
 * Filesystem Access
 *
 * The `fs` module provides functions for interacting with the file system.
 *
 * Most functions return `null` on failure, use `error()` to query the reason.
 *
 * @example
 * import { readlink, popen } from 'fs';
 * let dest = readlink('/sys/class/net/eth0');
 *
 * import * as fs from 'fs';
 * let proc = fs.popen('ps ww');
 *
 * @see https://ucode.mein.io/module-fs.html
 */
declare module "fs" {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    /**
     * Mode for `open()`: `r`, `w` or `a`, optionally followed by `+` for
     * read/write access, then optionally by `x` (exclusive creation) and/or
     * `e` (`O_CLOEXEC`).
     */
    export type FileOpenMode = `${"r" | "w" | "a"}${"" | "+"}${"" | "x" | "e" | "xe" | "ex"}`;

    /** Mode for `fdopen()`, must match the open mode of the descriptor. */
    export type FdOpenMode = `${"r" | "w" | "a"}${"" | "+"}`;

    /**
     * Mode for `popen()`: `r` to read the program's stdout, `w` to write to
     * its stdin, optionally followed by `e` to apply `FD_CLOEXEC`.
     */
    export type ProcOpenMode = "r" | "w" | "re" | "we";

    /**
     * Amount of data to read from a handle: a number of bytes, `"line"` for
     * an entire line (including the terminating newline), `"all"` for the
     * complete contents, or a single character to read up to and including.
     */
    export type ReadLength = number | "line" | "all" | (string & {});

    /** File type as reported by `stat()` and `lstat()`. */
    export type FileType =
        | "file"
        | "directory"
        | "char"
        | "block"
        | "fifo"
        | "link"
        | "socket"
        | "unknown";

    /** Result of `stat()` and `lstat()`. */
    export interface FileStatResult {
        /** The device information. */
        dev: {
            /** The major device number. */
            major: number;
            /** The minor device number. */
            minor: number;
        };
        /** The file permissions. */
        perm: {
            setuid: boolean;
            setgid: boolean;
            sticky: boolean;
            user_read: boolean;
            user_write: boolean;
            user_exec: boolean;
            group_read: boolean;
            group_write: boolean;
            group_exec: boolean;
            other_read: boolean;
            other_write: boolean;
            other_exec: boolean;
        };
        /** The inode number. */
        inode: number;
        /** The file mode. */
        mode: number;
        /** The number of hard links. */
        nlink: number;
        /** The user ID of the owner. */
        uid: number;
        /** The group ID of the owner. */
        gid: number;
        /** The file size in bytes. */
        size: number;
        /** The block size for file system I/O. */
        blksize: number;
        /** The number of 512-byte blocks allocated for the file. */
        blocks: number;
        /** The timestamp when the file was last accessed. */
        atime: number;
        /** The timestamp when the file was last modified. */
        mtime: number;
        /** The timestamp when the file status was last changed. */
        ctime: number;
        /** The type of the file. */
        type: FileType;
    }

    /** Result of `statvfs()`, mirroring `struct statvfs`. */
    export interface StatVFSResult {
        /** File system block size. */
        bsize: number;
        /** Fragment size. */
        frsize: number;
        /** Total blocks. */
        blocks: number;
        /** Free blocks. */
        bfree: number;
        /** Free blocks available to unprivileged users. */
        bavail: number;
        /** Total file nodes (inodes). */
        files: number;
        /** Free file nodes. */
        ffree: number;
        /** Free nodes available to unprivileged users. */
        favail: number;
        /** File system id. */
        fsid: number;
        /** Mount flags, a bitmask of the `ST_*` constants. */
        flag: number;
        /** Maximum filename length. */
        namemax: number;
        /** Free space in bytes (`frsize * bfree`). */
        freesize: number;
        /** Total size of the filesystem in bytes (`frsize * blocks`). */
        totalsize: number;
        /** Magic number of the filesystem, obtained from `statfs` (Linux only). */
        type?: number;
    }

    /**
     * A handle for interacting with a file opened by `open()`, `fdopen()`,
     * `mkstemp()` or `pipe()` (`fs.file` resource).
     */
    export interface FileHandle {
        /**
         * Flush buffered data and close the underlying file descriptor.
         *
         * @returns `true` if the handle was properly closed, `null` on error.
         */
        close(): boolean | null;

        /** Return a description of the last occurred error, or `null`. */
        error(): string | null;

        /** Return the number of the underlying file descriptor, or `null` on error. */
        fileno(): number | null;

        /** Force a write of all buffered data, returns `null` on error. */
        flush(): boolean | null;

        /**
         * Perform an ioctl operation on the file.
         *
         * @param direction One of the `IOC_DIR_*` constants.
         * @param type The ioctl type.
         * @param num The ioctl sequence number.
         * @param value Ignored for `IOC_DIR_NONE`; the amount of bytes to
         * expect for `IOC_DIR_READ`; the data buffer to send for
         * `IOC_DIR_WRITE` and `IOC_DIR_RW`.
         * @returns The read data for `IOC_DIR_READ` and `IOC_DIR_RW`,
         * otherwise the numeric return code. `null` on error.
         */
        ioctl(
            direction: number,
            type: number | null,
            num: number,
            value?: number | string,
        ): number | string | null;

        /**
         * Check whether the handle refers to a terminal device. Returns
         * `null` on error.
         */
        isatty(): boolean | null;

        /**
         * Lock or unlock the file.
         *
         * @param op Combination of `s` (shared lock), `x` (exclusive lock),
         * `n` (don't block) and `u` (unlock).
         */
        lock(op?: string): boolean | null;

        /**
         * Read a chunk of data from the file.
         *
         * @returns The read data, an empty string on EOF, `null` on error.
         * @example
         * const chunk = fp.read(10);
         * for (let line = fp.read("line"); length(line); line = fp.read("line"))
         *     print(line);
         * const content = fp.read("all");
         * const field = fp.read(":");
         */
        read(length: ReadLength): string | null;

        /**
         * Set the read position of the file.
         *
         * @param offset The offset in bytes, defaults to 0.
         * @param position `0` relative to the start (default), `1` relative
         * to the current position, `2` relative to the end.
         */
        seek(offset?: number, position?: 0 | 1 | 2): boolean | null;

        /** Return the current absolute read position, or `null` on error. */
        tell(): number | null;

        /** Truncate the file to the given size (default 0). */
        truncate(offset?: number): boolean | null;

        /**
         * Write data to the file. Non-string values are converted like
         * `print()` does (JSON for arrays and objects, `null` as empty
         * string).
         *
         * @returns The number of bytes written, `null` on error.
         */
        write(data: unknown): number | null;
    }

    /** A handle for interacting with a directory opened by `opendir()` (`fs.dir` resource). */
    export interface DirHandle {
        /** Close the directory handle, returns `null` on error. */
        close(): boolean | null;

        /** Return a description of the last occurred error, or `null`. */
        error(): string | null;

        /** Return the number of the underlying file descriptor, or `null` on error. */
        fileno(): number | null;

        /**
         * Read the next entry name, or `null` when there are no more entries
         * or on error.
         */
        read(): string | null;

        /** Set the read position to an offset previously obtained by `tell()`. */
        seek(offset: number): boolean | null;

        /** Return the current read position, to be passed to `seek()`. */
        tell(): number | null;
    }

    /** A handle for interacting with a program launched by `popen()` (`fs.proc` resource). */
    export interface ProcHandle {
        /**
         * Close the program's input or output stream and wait for its
         * termination.
         *
         * @returns The exit code, the negative signal number if the program
         * was killed by a signal, or `null` on error.
         */
        close(): number | null;

        /** Return a description of the last occurred error, or `null`. */
        error(): string | null;

        /** Return the number of the underlying file descriptor, or `null` on error. */
        fileno(): number | null;

        /** Force a write of all buffered data, returns `null` on error. */
        flush(): boolean | null;

        /**
         * Read a chunk of data from the program's stdout.
         *
         * @returns The read data, an empty string on EOF, `null` on error.
         * @see FileHandle.read
         */
        read(length: ReadLength): string | null;

        /**
         * Write data to the program's stdin. Non-string values are converted
         * like `print()` does.
         *
         * @returns The number of bytes written, `null` on error.
         */
        write(data: unknown): number | null;
    }

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /** Handle for the standard input stream. */
    export const stdin: FileHandle;

    /** Handle for the standard output stream. */
    export const stdout: FileHandle;

    /** Handle for the standard error stream. */
    export const stderr: FileHandle;

    /** `ioctl()` direction: no data is passed. */
    export const IOC_DIR_NONE: number;
    /** `ioctl()` direction: userspace is writing and kernel is reading. */
    export const IOC_DIR_WRITE: number;
    /** `ioctl()` direction: kernel is writing and userspace is reading. */
    export const IOC_DIR_READ: number;
    /** `ioctl()` direction: userspace is writing and kernel is writing back. */
    export const IOC_DIR_RW: number;

    /** Mount flag: mandatory locking (Linux only). */
    export const ST_MANDLOCK: number;
    /** Mount flag: do not update access times (Linux only). */
    export const ST_NOATIME: number;
    /** Mount flag: do not allow device files (Linux only). */
    export const ST_NODEV: number;
    /** Mount flag: do not update directory access times (Linux only). */
    export const ST_NODIRATIME: number;
    /** Mount flag: do not allow execution of binaries (Linux only). */
    export const ST_NOEXEC: number;
    /** Mount flag: do not allow set-user-identifier or set-group-identifier bits. */
    export const ST_NOSUID: number;
    /** Mount flag: read-only filesystem. */
    export const ST_RDONLY: number;
    /** Mount flag: update access times relative to modification time (Linux only). */
    export const ST_RELATIME: number;
    /** Mount flag: synchronous writes (Linux only). */
    export const ST_SYNCHRONOUS: number;
    /** Mount flag: do not follow symbolic links (Linux only). */
    export const ST_NOSYMFOLLOW: number;

    // -----------------------------------------------------------------------
    // Functions
    // -----------------------------------------------------------------------

    /**
     * Check the accessibility of a file or directory.
     *
     * @param mode Combination of `r` (readable), `w` (writable),
     * `x` (executable) and `f` (exists, the default). All given modes must
     * be possible.
     * @returns `null` if an error occurred, e.g. due to inaccessible
     * intermediate path components.
     * @example
     * access('path/to/file', 'rw');
     * access('/usr/bin/example', 'x');
     */
    export function access(path: string, mode?: string): boolean | null;

    /**
     * Return the base name component of a path.
     *
     * @example
     * basename('/path/to/file.txt')  // "file.txt"
     */
    export function basename(path: string): string;

    /** Change the current working directory, returns `null` on error. */
    export function chdir(path: string): boolean | null;

    /**
     * Change the permission mode bits of a file or directory, returns `null`
     * on error.
     *
     * @example
     * chmod('path/to/file', 0o644);
     */
    export function chmod(path: string, mode: number): boolean | null;

    /**
     * Change the owner and group of a file or directory.
     *
     * User and group may be given as numeric id or as name. Omitted, `null`
     * or `-1` values are left unchanged.
     *
     * @returns `null` on error or if a name cannot be resolved.
     * @example
     * chown('path/to/file', 1000);
     * chown('/htdocs/', null, 'www-data');
     */
    export function chown(
        path: string,
        uid?: number | string | null,
        gid?: number | string | null,
    ): boolean | null;

    /**
     * Return the directory name component of a path.
     *
     * @example
     * dirname('/path/to/file.txt')  // "/path/to"
     */
    export function dirname(path: string): string;

    /**
     * Duplicate the file descriptor `oldfd` to `newfd`, silently closing
     * `newfd` first if it was open. Returns `null` on error.
     *
     * @example
     * const logfile = open('/tmp/error.log', 'w');
     * dup2(logfile.fileno(), 2);
     */
    export function dup2(oldfd: number, newfd: number): boolean | null;

    /**
     * Return a description of the last occurred error, or `null` if there is
     * no error information.
     *
     * @example
     * unlink('/path/does/not/exist');
     * print(error(), "\n");  // "No such file or directory"
     */
    export function error(): string | null;

    /**
     * Associate a file descriptor number with a file handle.
     *
     * @param mode Defaults to `"r"`, must match the descriptor's open mode.
     * @example
     * const stdinHandle = fdopen(0, 'r');
     */
    export function fdopen(fd: number, mode?: FdOpenMode): FileHandle | null;

    /** Return the current working directory, or `null` on error. */
    export function getcwd(): string | null;

    /**
     * Resolve the given glob patterns. Matches of each pattern are sorted,
     * but combined results are neither deduplicated nor globally sorted.
     *
     * @example
     * glob('*.crt', '*.pem')
     */
    export function glob(...patterns: string[]): string[] | null;

    /**
     * Return the sorted names of the entries of a directory, or `null` on
     * error.
     */
    export function lsdir(path: string): string[] | null;

    /**
     * Return information about a file or directory, without following
     * symbolic links. Returns `null` on error.
     */
    export function lstat(path: string): FileStatResult | null;

    /** Create a new directory, returns `null` on error. */
    export function mkdir(path: string): boolean | null;

    /**
     * Create a unique temporary directory and return its path.
     *
     * The template must end with `XXXXXX` (appended if missing). A template
     * without directory separator is placed in `/tmp/`.
     *
     * @param template Defaults to `"/tmp/XXXXXX"`.
     * @returns `null` on error.
     * @example
     * const tempDir = mkdtemp('./data-XXXXXX');
     */
    export function mkdtemp(template?: string): string | null;

    /**
     * Create, open (read/write) and immediately unlink a unique temporary
     * file. The file vanishes once the handle is closed.
     *
     * @param template Defaults to `"/tmp/XXXXXX"`.
     * @returns `null` on error.
     */
    export function mkstemp(template?: string): FileHandle | null;

    /**
     * Open a file.
     *
     * | Mode   | Description                                          |
     * | ------ | ---------------------------------------------------- |
     * | `"r"`  | Read. The file must exist.                           |
     * | `"w"`  | Write. Truncates or creates the file.                |
     * | `"a"`  | Append. Creates the file if needed.                  |
     * | `"r+"` | Read and write. The file must exist.                 |
     * | `"w+"` | Read and write. Truncates or creates the file.       |
     * | `"a+"` | Read and append. Creates the file if needed.         |
     *
     * Append `x` for exclusive creation and/or `e` for `O_CLOEXEC`.
     *
     * @param mode Defaults to `"r"`.
     * @param perm Creation permissions for `w…` and `a…` modes, defaults to
     * `0o666`.
     * @returns `null` on error.
     * @example
     * const fp = open('file.txt', 'r');
     */
    export function open(path: string, mode?: FileOpenMode, perm?: number): FileHandle | null;

    /** Open a directory, returns `null` on error. */
    export function opendir(path: string): DirHandle | null;

    /**
     * Create a pipe.
     *
     * @returns `[read end, write end]`, or `null` on error.
     * @example
     * const [ rd, wr ] = pipe();
     * wr.write("Hello world\n");
     * print(rd.read("line"));
     */
    export function pipe(): [read: FileHandle, write: FileHandle] | null;

    /**
     * Start a process and return a handle connected to its stdout (`"r"`)
     * or stdin (`"w"`).
     *
     * A string command is run through `/bin/sh -c`, an array is executed
     * directly via `execvp()` without involving a shell.
     *
     * @param mode Defaults to `"r"`.
     * @returns `null` on error.
     * @example
     * const proc = popen('ls -la /tmp', 'r');
     * const proc = popen([ 'ls', '-la', '/tmp' ], 'r');
     */
    export function popen(
        command: string | readonly unknown[],
        mode?: ProcOpenMode,
    ): ProcHandle | null;

    /**
     * Read the contents of a file, optionally limited to `limit` bytes.
     * Returns `null` on error.
     */
    export function readfile(path: string, limit?: number): string | null;

    /** Return the target of a symbolic link, or `null` on error. */
    export function readlink(path: string): string | null;

    /** Resolve the absolute path of a file or directory, or `null` on error. */
    export function realpath(path: string): string | null;

    /** Rename or move a file or directory, returns `null` on error. */
    export function rename(oldPath: string, newPath: string): boolean | null;

    /** Remove a directory, returns `null` on error. */
    export function rmdir(path: string): boolean | null;

    /**
     * Return information about a file or directory, following symbolic
     * links. Returns `null` on error.
     */
    export function stat(path: string): FileStatResult | null;

    /** Query filesystem statistics for a path, returns `null` on error. */
    export function statvfs(path: string): StatVFSResult | null;

    /** Create a symbolic link at `path` pointing to `target`, returns `null` on error. */
    export function symlink(target: string, path: string): boolean | null;

    /** Remove a file or symbolic link, returns `null` on error. */
    export function unlink(path: string): boolean | null;

    /**
     * Write data to a file, truncating or creating it (with `0o666` masked
     * by the umask). Non-string values are converted like `print()` does.
     *
     * @param limit Maximum amount of bytes to write.
     * @returns The number of bytes written, `null` on error.
     * @example
     * writefile('path/to/file', 'Hello, World!');
     * writefile('debug.txt', { foo: "Hello world" }, 1024);
     */
    export function writefile(path: string, data: unknown, limit?: number): number | null;
}
