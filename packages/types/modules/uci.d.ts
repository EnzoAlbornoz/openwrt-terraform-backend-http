/**
 * OpenWrt UCI configuration
 *
 * The `uci` module reads and writes the configuration in `/etc/config`.
 * Operations go through a cursor, which loads packages on first access.
 *
 * Most functions return `null` on failure, use `error()` to query the reason.
 *
 * @example
 * import { cursor } from 'uci';
 * let ctx = cursor();
 * ctx.get('system', '@system[0]', 'hostname');
 *
 * @see https://ucode.mein.io/module-uci.html
 */
declare module "uci" {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    /** An option value: a string for `option`, an array for `list`. */
    export type UciValue = string | string[];

    /** A section as returned by `get_all()` and `foreach()`. */
    export interface UciSection {
        /** Whether the section has no name (`config type` without a name). */
        ".anonymous": boolean;
        /** The section type. */
        ".type": string;
        /** The section name, generated (e.g. `cfg0a1b2c`) for anonymous sections. */
        ".name": string;
        /** The position of the section in its package. */
        ".index"?: number;
        [option: string]: UciValue | boolean | number | undefined;
    }

    export interface UciCursor {
        /** Load a package; returns `true`, or `null` on error. */
        load(config: string): true | null;

        /** Unload a package, discarding unsaved changes; returns whether it was loaded. */
        unload(config: string): boolean;

        /**
         * The value of an option, or the type of a section when `option` is
         * omitted. `section` may use extended syntax (`@type[index]`).
         * Returns `null` if the package, section or option does not exist.
         */
        get(config: string, section: string, option?: string): UciValue | null;

        /**
         * A section, or all sections of a package keyed by name when
         * `section` is omitted. Returns `null` if they do not exist.
         */
        get_all(config: string, section: string): UciSection | null;
        get_all(config: string): Record<string, UciSection> | null;

        /**
         * The value of an option of the first section of the given type, or
         * that section's name when `option` is omitted.
         */
        get_first(config: string, type: string, option?: string): UciValue | null;

        /**
         * Call `callback` for each section of the given type, or of any type
         * if `type` is `null`. Returning `false` stops the iteration. Returns
         * whether a section was visited.
         */
        foreach(
            config: string,
            type: string | null,
            callback: (section: UciSection) => boolean | void,
        ): boolean;

        /** Set the value of an option, or create a section of type `value` if `option` is omitted. */
        set(config: string, section: string, option: string, value: UciValue): true | null;
        set(config: string, section: string, value: string): true | null;

        /** Delete an option, or a section if `option` is omitted. */
        delete(config: string, section: string, option?: string): true | null;

        /** Stage the changes of a package, or of all packages, in the delta directory. */
        save(config?: string): true | null;

        /** Write the changes of a package, or of all packages, to `/etc/config`. */
        commit(config?: string): true | null;

        /** The names of all packages in the configuration directory. */
        configs(): string[] | null;

        /** The last error of this cursor, or `null`. */
        error(): string | null;
    }

    // -----------------------------------------------------------------------
    // Functions
    // -----------------------------------------------------------------------

    /**
     * Create a cursor.
     *
     * @param config_dir Directory of the configuration files, defaults to `/etc/config`.
     * @param delta_dir Directory of staged changes, defaults to `/tmp/.uci`.
     */
    export function cursor(config_dir?: string, delta_dir?: string): UciCursor | null;

    /** The last error of a module function, or `null`. */
    export function error(): string | null;
}
