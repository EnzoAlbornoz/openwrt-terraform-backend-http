/**
 * Settings, read from the UCI package `terraform-backend`
 * (`/etc/config/terraform-backend`):
 *
 * ```
 * config storage 'storage'
 *     option state_dir '/etc/terraform'
 *     option lock_dir '/var/run/terraform'
 *     option max_state_size '16M'
 * ```
 *
 * Missing options, sections or packages fall back to the defaults below.
 * Every request runs in a new process, so changes apply to the next request
 * without restarting uhttpd. Invalid values fail the request, rather than
 * silently storing states somewhere else.
 */

import * as uci from "uci";

import type { Storage } from "./store.js";

export interface Config {
    storage: Storage;
    /** Largest accepted state, in bytes. */
    maxStateSize: number;
}

/** The UCI package holding the settings. */
export const CONFIG_PACKAGE = "terraform-backend";

const DEFAULT_STATE_DIR = "/etc/terraform";
const DEFAULT_LOCK_DIR = "/var/run/terraform";
const DEFAULT_MAX_STATE_SIZE = 16 * 1024 * 1024;

/** A size in bytes, optionally with a `K` or `M` suffix. */
const SIZE_PATTERN = /^([0-9]+)([KkMm]?)$/;

function invalid(section: string, name: string, reason: string): never {
    die("Invalid " + CONFIG_PACKAGE + "." + section + "." + name + ": " + reason);
}

/** A string option, or `null` if it is not set. */
function option(ctx: uci.UciCursor, section: string, name: string): string | null {
    const value = ctx.get(CONFIG_PACKAGE, section, name);

    if (value != null && type(value) != "string")
        invalid(section, name, "expected an option, not a list");

    return value as string | null;
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
    const ctx = uci.cursor();

    if (ctx == null) die("Cannot read the UCI configuration: " + uci.error());

    return {
        storage: {
            stateDir: directory(ctx, "state_dir", DEFAULT_STATE_DIR),
            lockDir: directory(ctx, "lock_dir", DEFAULT_LOCK_DIR),
        },
        maxStateSize: size(ctx, "max_state_size", DEFAULT_MAX_STATE_SIZE),
    };
}
