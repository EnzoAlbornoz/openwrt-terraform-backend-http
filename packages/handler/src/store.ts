/**
 * File storage for Terraform states and their locks.
 *
 * - States are kept in `<stateDir>/<workspace>/<name>.tfstate`. A new state
 *   is written to a temporary file, then renamed over the old one, so
 *   readers never see a partial state and need no locking.
 * - Locks are kept in `<lockDir>/<workspace>/<name>.lock`, holding the lock
 *   info JSON sent by Terraform verbatim. The lock directory is on tmpfs, so
 *   locks do not survive a reboot.
 * - uhttpd serves every request in its own process, so checking a lock and
 *   acting on it runs under an exclusive `flock()` of
 *   `<lockDir>/<workspace>/<name>.mutex` (see `withStateMutex()`).
 */

import { error, lstat, mkdir, open, readfile, rename, stat, unlink, type FileHandle } from "fs";

/** Where states and locks are kept, as absolute paths without trailing `/`. */
export interface Storage {
    /** Where states are persisted. */
    stateDir: string;
    /** Where locks are kept. */
    lockDir: string;
}

/** Identifies a state. Both names are validated with `isValidName()`. */
export interface StateRef {
    storage: Storage;
    workspace: string;
    name: string;
}

/** A held lock. */
export interface Lock {
    id: string;
    /** The lock info JSON, as sent by the client that took the lock. */
    raw: string;
}

/** A temporary file a new state is written to, see `createStateUpload()`. */
export interface StateUpload {
    path: string;
    file: FileHandle;
}

/**
 * Names start with a letter, digit or `_` (so `.`, `..` and hidden files are
 * excluded) and continue with letters, digits, `.`, `_` or `-`.
 */
const NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
const NAME_MAX = 128;

let tempCount = 0;

/** Whether `name` is safe to use as a workspace or state name. */
export function isValidName(name: string): boolean {
    return length(name) <= NAME_MAX && match(name, NAME_PATTERN) != null;
}

/** The ID of parsed lock info, or `null` if it has no non-empty string `ID`. */
export function lockId(info: unknown): string | null {
    if (type(info) != "object") return null;

    const id = (info as Record<string, unknown>)["ID"];

    return type(id) == "string" && id != "" ? (id as string) : null;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Create an absolute directory path, like `mkdir -p` with mode 0700. */
function ensureDir(path: string): void {
    const parts = split(path, "/");
    let current = "";

    for (let i = 1; i < length(parts); i++) {
        current += "/" + parts[i];
        // Fails harmlessly for directories that already exist.
        mkdir(current, 0o700);
    }

    if (stat(path)?.type != "directory") die("Cannot create directory " + path + ": " + error());
}

/** Create a new, empty temporary file in `dir`, readable by the owner only. */
function createTemp(dir: string, name: string): StateUpload {
    const now = clock();
    const path = sprintf("%s/.%s.%d%09d-%d.tmp", dir, name, now[0], now[1], tempCount++);
    const file = open(path, "wx", 0o600);

    if (file == null) die("Cannot create " + path + ": " + error());

    return { path, file };
}

/** Replace `path` with a file holding `data`, atomically. */
function writeAtomic(dir: string, name: string, path: string, data: string): void {
    const temp = createTemp(dir, name);
    const written = temp.file.write(data);

    if (temp.file.close() != true || written != length(data)) {
        unlink(temp.path);
        die("Cannot write " + temp.path);
    }

    if (rename(temp.path, path) == null) {
        const reason = error();

        unlink(temp.path);
        die("Cannot replace " + path + ": " + reason);
    }
}

/** Fail unless `path` is missing: a failed call on an existing file is an I/O error. */
function assertMissing(path: string, what: string): void {
    if (lstat(path) != null) die("Cannot " + what + " " + path + ": " + error());
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

function lockDir(ref: StateRef): string {
    return ref.storage.lockDir + "/" + ref.workspace;
}

function lockPath(ref: StateRef): string {
    return lockDir(ref) + "/" + ref.name + ".lock";
}

/**
 * Run `fn` holding the state's mutex, so that no other request reads or
 * changes its lock (or commits it) in the meantime. Exceptions from `fn` are
 * rethrown once the mutex is released.
 */
export function withStateMutex<T>(ref: StateRef, fn: () => T): T {
    const dir = lockDir(ref);

    ensureDir(dir);

    const path = dir + "/" + ref.name + ".mutex";
    const mutex = open(path, "a", 0o600);

    if (mutex == null) die("Cannot open " + path + ": " + error());

    if (mutex.lock("x") != true) {
        const reason = mutex.error();

        mutex.close();
        die("Cannot lock " + path + ": " + reason);
    }

    let result: T;

    try {
        result = fn();
    } catch (err) {
        mutex.close();
        die(err as UcodeException);
    }

    mutex.close();

    return result;
}

/** The lock held on a state, or `null`. Call with the state's mutex held. */
export function readLock(ref: StateRef): Lock | null {
    const path = lockPath(ref);
    const raw = readfile(path);

    if (raw == null) {
        assertMissing(path, "read lock");
        return null;
    }

    let id: string | null = null;

    try {
        id = lockId(json(raw));
    } catch {
        id = null;
    }

    if (id == null) die("Corrupted lock " + path);

    return { id, raw };
}

/**
 * Store lock info, which must be a JSON object with an `ID` (see
 * `lockId()`). Call with the state's mutex held.
 */
export function writeLock(ref: StateRef, raw: string): void {
    writeAtomic(lockDir(ref), ref.name + ".lock", lockPath(ref), raw);
}

/** Release the lock on a state. Call with the state's mutex held. */
export function removeLock(ref: StateRef): void {
    const path = lockPath(ref);

    if (unlink(path) == null) assertMissing(path, "remove lock");
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

function stateDir(ref: StateRef): string {
    return ref.storage.stateDir + "/" + ref.workspace;
}

function statePath(ref: StateRef): string {
    return stateDir(ref) + "/" + ref.name + ".tfstate";
}

/** Open a state for reading, or return `null` if it does not exist. */
export function openState(ref: StateRef): FileHandle | null {
    const path = statePath(ref);
    const file = open(path, "r");

    if (file == null) assertMissing(path, "open state");

    return file;
}

/**
 * Create the temporary file a new state is written to. Close it, then
 * `commitState()` it; remove it if anything fails.
 */
export function createStateUpload(ref: StateRef): StateUpload {
    const dir = stateDir(ref);

    ensureDir(dir);

    return createTemp(dir, ref.name + ".tfstate");
}

/** Replace a state with a closed upload. */
export function commitState(ref: StateRef, upload: StateUpload): void {
    const path = statePath(ref);

    if (rename(upload.path, path) == null) die("Cannot replace " + path + ": " + error());
}

/** Delete a state; returns whether it existed. */
export function removeState(ref: StateRef): boolean {
    const path = statePath(ref);

    if (unlink(path) != null) return true;

    assertMissing(path, "remove state");

    return false;
}
