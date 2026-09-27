/**
 * Settings, read from the UCI package `terraform-backend`
 * (`/etc/config/terraform-backend`):
 *
 * ```
 * config storage 'storage'
 *     option state_dir '/etc/terraform'
 *     option lock_dir '/var/run/terraform'
 *     option max_state_size '16M'
 *
 * config auth 'auth'
 *     option enabled '1'
 *     option allow_http '0'
 *
 * config user 'ci'
 *     option password 'sha256$<salt>$<hex sha256 of salt + password>'
 *     list workspace 'home'
 * ```
 *
 * Users are sections of type `user`, named after the user. Without
 * `workspace`, a user may access every workspace. `terraform-backend-user`
 * creates users with random passwords.
 *
 * Missing options, sections or packages fall back to the defaults below.
 * Every request runs in a new process, so changes apply to the next request
 * without restarting uhttpd. Invalid values fail the request, rather than
 * silently storing states somewhere else.
 */

import * as uci from "uci";

import { isValidName, type Storage } from "./store.js";

export interface Config {
    storage: Storage;
    /** Largest accepted state, in bytes. */
    maxStateSize: number;
    /** Whether requests need the credentials of a user. */
    authEnabled: boolean;
    /** Whether to serve requests over plain HTTP. */
    allowHttp: boolean;
}

/** A user allowed to access states. */
export interface User {
    name: string;
    salt: string;
    /** The SHA-256 of the salt followed by the password, in lowercase hex. */
    hash: string;
    /** The workspaces the user may access, or `null` for all of them. */
    workspaces: string[] | null;
}

/** The UCI package holding the settings. */
export const CONFIG_PACKAGE = "terraform-backend";

const DEFAULT_STATE_DIR = "/etc/terraform";
const DEFAULT_LOCK_DIR = "/var/run/terraform";
const DEFAULT_MAX_STATE_SIZE = 16 * 1024 * 1024;

/** A size in bytes, optionally with a `K` or `M` suffix. */
const SIZE_PATTERN = /^([0-9]+)([KkMm]?)$/;

/** A user name, which is also the name of its section. */
const USER_PATTERN = /^[A-Za-z0-9_]+$/;

/** A password hash: `sha256$<salt>$<hex digest>`. */
const PASSWORD_PATTERN = /^sha256\$([^$]+)\$([0-9a-f]{64})$/;

/** The values UCI reads as true and false. */
const TRUE_VALUES = ["1", "yes", "on", "true", "enabled"];
const FALSE_VALUES = ["0", "no", "off", "false", "disabled"];

function invalid(section: string, name: string, reason: string): never {
    die("Invalid " + CONFIG_PACKAGE + "." + section + "." + name + ": " + reason);
}

function cursor(): uci.UciCursor {
    const ctx = uci.cursor();

    if (ctx == null) die("Cannot read the UCI configuration: " + uci.error());

    return ctx;
}

/** A string option, or `null` if it is not set. */
function option(ctx: uci.UciCursor, section: string, name: string): string | null {
    const value = ctx.get(CONFIG_PACKAGE, section, name);

    if (value != null && type(value) != "string")
        invalid(section, name, "expected an option, not a list");

    return value as string | null;
}

/** A list, also accepting a single value set as option. */
function list(ctx: uci.UciCursor, section: string, name: string): string[] | null {
    const value = ctx.get(CONFIG_PACKAGE, section, name);

    if (value == null) return null;

    return type(value) == "array" ? (value as string[]) : [value as string];
}

/** A boolean option. */
function flag(ctx: uci.UciCursor, section: string, name: string, fallback: boolean): boolean {
    const value = option(ctx, section, name);

    if (value == null) return fallback;
    if (index(TRUE_VALUES, value) >= 0) return true;
    if (index(FALSE_VALUES, value) >= 0) return false;

    invalid(section, name, "expected a boolean such as 0 or 1");
}

/** An absolute directory path, without trailing `/`. */
function directory(ctx: uci.UciCursor, name: string, fallback: string): string {
    const value = option(ctx, "storage", name);

    if (value == null) return fallback;

    const path = rtrim(value, "/");

    if (index(value, "/") != 0 || path == "") invalid("storage", name, "expected an absolute path");

    return path;
}

/** A positive size in bytes. */
function size(ctx: uci.UciCursor, name: string, fallback: number): number {
    const value = option(ctx, "storage", name);

    if (value == null) return fallback;

    const parts = match(value, SIZE_PATTERN);

    if (parts == null) invalid("storage", name, "expected a size such as 16777216, 16384K or 16M");

    const unit = lc(parts[2] as string);
    const bytes = int(parts[1]) * (unit == "m" ? 1024 * 1024 : unit == "k" ? 1024 : 1);

    if (bytes <= 0) invalid("storage", name, "expected a positive size");

    return bytes;
}

/** Read the settings. */
export function loadConfig(): Config {
    const ctx = cursor();

    return {
        storage: {
            stateDir: directory(ctx, "state_dir", DEFAULT_STATE_DIR),
            lockDir: directory(ctx, "lock_dir", DEFAULT_LOCK_DIR),
        },
        maxStateSize: size(ctx, "max_state_size", DEFAULT_MAX_STATE_SIZE),
        authEnabled: flag(ctx, "auth", "enabled", true),
        allowHttp: flag(ctx, "auth", "allow_http", false),
    };
}

/** Read the user called `name`, or `null` if there is none. */
export function loadUser(name: string): User | null {
    // Also keeps out UCI's extended syntax: `@user[0]` names the first user.
    if (match(name, USER_PATTERN) == null) return null;

    const ctx = cursor();

    if (ctx.get(CONFIG_PACKAGE, name) != "user") return null;

    const password = match(option(ctx, name, "password") ?? "", PASSWORD_PATTERN);

    if (password == null) invalid(name, "password", "expected sha256$<salt>$<hex digest>");

    const workspaces = list(ctx, name, "workspace");

    for (let i = 0; workspaces != null && i < length(workspaces); i++) {
        if (!isValidName(workspaces[i] as string))
            invalid(name, "workspace", "expected workspace names");
    }

    return { name, salt: password[1] as string, hash: password[2] as string, workspaces };
}
