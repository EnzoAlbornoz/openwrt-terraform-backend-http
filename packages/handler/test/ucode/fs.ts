/**
 * A Node stand-in for ucode's `fs` module, imported by the handler sources in
 * place of the real one (see `../setup.ts`).
 *
 * Paths are resolved inside a sandbox directory (`setRoot()`), so the
 * handler's `/etc/terraform` lands in `<root>/etc/terraform`. Functions
 * return `null` on failure and record the reason for `error()`, like ucode.
 *
 * Tests run in a single process, one request at a time: `lock()` succeeds
 * without locking anything.
 *
 * @see https://ucode-lang.org/module-fs.html
 */

import * as nfs from "node:fs";
import * as npath from "node:path";

import { RESOURCE, tostring } from "./runtime.ts";

let root: string | null = null;
let lastError: string | null = null;

/** Set the sandbox directory paths are resolved in. */
export function setRoot(dir: string | null): void {
    root = dir;
}

/** The host path of a ucode path. */
export function hostPath(path: string): string {
    if (root == null) throw new Error("fs shim: no sandbox root, call setRoot() first");

    return npath.join(root, path);
}

function fail(err: unknown): null {
    lastError = err instanceof Error ? err.message : String(err);

    return null;
}

function attempt<T>(fn: () => T): T | null {
    try {
        return fn();
    } catch (err) {
        return fail(err);
    }
}

/** A readable and/or writable byte source, backing `FileHandle`. */
interface Source {
    size(): number;
    read(buffer: Buffer, position: number): number;
    write(buffer: Buffer, position: number | null): number;
    close(): void;
}

class FileHandle {
    readonly [RESOURCE] = "fs.file";
    #source: Source | null;
    #append: boolean;
    #position = 0;

    constructor(source: Source, append: boolean) {
        this.#source = source;
        this.#append = append;
    }

    #readBytes(size: number): string {
        const buffer = Buffer.alloc(size);
        const count = (this.#source as Source).read(buffer, this.#position);

        this.#position += count;

        return buffer.toString("latin1", 0, count);
    }

    read(length: number | string): string | null {
        if (this.#source == null) return fail("Bad file descriptor");

        if (typeof length === "number") return this.#readBytes(Math.max(length, 0));

        const size = this.#source.size();

        if (length === "all") return this.#readBytes(Math.max(size - this.#position, 0));

        // "line" or a single delimiter character: read up to and including it.
        const delimiter = length === "line" ? "\n" : length;
        let result = "";

        while (this.#position < size) {
            const char = this.#readBytes(1);

            result += char;

            if (char === delimiter) break;
        }

        return result;
    }

    write(data: unknown): number | null {
        if (this.#source == null) return fail("Bad file descriptor");

        const buffer = Buffer.from(data == null ? "" : tostring(data), "latin1");
        const source = this.#source;
        const count = attempt(() => source.write(buffer, this.#append ? null : this.#position));

        if (count == null) return null;

        this.#position = this.#append ? source.size() : this.#position + count;

        return count;
    }

    seek(offset = 0, whence: 0 | 1 | 2 = 0): boolean | null {
        if (this.#source == null) return fail("Bad file descriptor");

        const base = whence === 0 ? 0 : whence === 1 ? this.#position : this.#source.size();

        if (base + offset < 0) return fail("Invalid argument");

        this.#position = base + offset;

        return true;
    }

    tell(): number | null {
        return this.#source == null ? fail("Bad file descriptor") : this.#position;
    }

    flush(): boolean | null {
        return this.#source == null ? fail("Bad file descriptor") : true;
    }

    lock(op?: string): boolean | null {
        if (this.#source == null) return fail("Bad file descriptor");
        if (typeof op !== "string" || !/^[sxnu]+$/.test(op)) return fail("Invalid argument");

        return true;
    }

    close(): boolean | null {
        const source = this.#source;

        if (source == null) return fail("Bad file descriptor");

        this.#source = null;

        return attempt(() => {
            source.close();
            return true;
        });
    }

    error(): string | null {
        return lastError;
    }
}

function fileSource(fd: number): Source {
    return {
        size: () => nfs.fstatSync(fd).size,
        read: (buffer, position) => nfs.readSync(fd, buffer, 0, buffer.length, position),
        write: (buffer, position) => nfs.writeSync(fd, buffer, 0, buffer.length, position),
        close: () => nfs.closeSync(fd),
    };
}

// ---------------------------------------------------------------------------
// Standard streams
// ---------------------------------------------------------------------------

let stdinData: Buffer = Buffer.alloc(0);

/** Set what `stdin` reads: the request body uhttpd pipes to the handler. */
export function setStdin(data: Buffer): void {
    stdinData = data;
    stdin.seek(0, 0);
}

export const stdin = new FileHandle(
    {
        size: () => stdinData.length,
        read: (buffer, position) => stdinData.copy(buffer, 0, position),
        write: () => {
            throw new Error("Bad file descriptor");
        },
        close: () => {},
    },
    false,
);

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export function error(): string | null {
    const message = lastError;

    lastError = null;

    return message;
}

const OPEN_FLAGS: Record<string, string> = {
    r: "r",
    "r+": "r+",
    w: "w",
    "w+": "w+",
    wx: "wx",
    "wx+": "wx+",
    a: "a",
    "a+": "a+",
    ax: "ax",
    "ax+": "ax+",
};

export function open(path: string, mode = "r", perm = 0o666): FileHandle | null {
    const base = mode.charAt(0);
    const flags =
        OPEN_FLAGS[base + (mode.includes("x") ? "x" : "") + (mode.includes("+") ? "+" : "")];

    if (flags == null) return fail("Invalid argument");

    const fd = attempt(() => nfs.openSync(hostPath(path), flags, perm));

    return fd == null ? null : new FileHandle(fileSource(fd), base === "a");
}

export function readfile(path: string, limit?: number): string | null {
    const data = attempt(() => nfs.readFileSync(hostPath(path)));

    if (data == null) return null;

    return data.toString("latin1", 0, limit != null && limit > 0 ? limit : data.length);
}

export function writefile(path: string, data: unknown, limit?: number): number | null {
    let buffer = Buffer.from(data == null ? "" : tostring(data), "latin1");

    if (limit != null && limit >= 0) buffer = buffer.subarray(0, limit);

    return attempt(() => {
        nfs.writeFileSync(hostPath(path), buffer);
        return buffer.length;
    });
}

export function mkdir(path: string, mode = 0o777): boolean | null {
    return attempt(() => {
        nfs.mkdirSync(hostPath(path), { mode });
        return true;
    });
}

export function rmdir(path: string): boolean | null {
    return attempt(() => {
        nfs.rmdirSync(hostPath(path));
        return true;
    });
}

export function rename(oldPath: string, newPath: string): boolean | null {
    return attempt(() => {
        nfs.renameSync(hostPath(oldPath), hostPath(newPath));
        return true;
    });
}

export function unlink(path: string): boolean | null {
    return attempt(() => {
        nfs.unlinkSync(hostPath(path));
        return true;
    });
}

export function lsdir(path: string): string[] | null {
    return attempt(() => nfs.readdirSync(hostPath(path)).sort());
}

function statResult(stats: nfs.Stats) {
    const type = stats.isFile()
        ? "file"
        : stats.isDirectory()
          ? "directory"
          : stats.isSymbolicLink()
            ? "link"
            : "unknown";

    return {
        type,
        size: stats.size,
        mode: stats.mode & 0o7777,
        nlink: stats.nlink,
        uid: stats.uid,
        gid: stats.gid,
        inode: stats.ino,
        atime: Math.floor(stats.atimeMs / 1000),
        mtime: Math.floor(stats.mtimeMs / 1000),
        ctime: Math.floor(stats.ctimeMs / 1000),
    };
}

export function stat(path: string) {
    return attempt(() => statResult(nfs.statSync(hostPath(path))));
}

export function lstat(path: string) {
    return attempt(() => statResult(nfs.lstatSync(hostPath(path))));
}

export function access(path: string, mode = "f"): boolean | null {
    const flags =
        (mode.includes("r") ? nfs.constants.R_OK : 0) |
        (mode.includes("w") ? nfs.constants.W_OK : 0) |
        (mode.includes("x") ? nfs.constants.X_OK : 0);

    return attempt(() => {
        nfs.accessSync(hostPath(path), flags);
        return true;
    });
}

export function basename(path: string): string {
    return npath.posix.basename(path);
}

export function dirname(path: string): string {
    return npath.posix.dirname(path);
}
