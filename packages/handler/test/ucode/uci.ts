/**
 * A Node stand-in for ucode's `uci` module: a read-only cursor over
 * in-memory packages set with `setConfig()`, instead of `/etc/config`.
 *
 * @see https://ucode-lang.org/module-uci.html
 */

type UciValue = string | string[];

/** Packages, keyed by name, holding named sections of options. */
export type UciPackages = Record<string, Record<string, Record<string, UciValue>>>;

let packages: UciPackages = {};

/** Replace the configuration read by cursors. */
export function setConfig(config: UciPackages): void {
    packages = structuredClone(config);
}

export function cursor() {
    return {
        get(config: string, section: string, option?: string): UciValue | null {
            const options = packages[config]?.[section];

            if (options == null) return null;
            if (option == null) return options[".type"] ?? null;

            return options[option] ?? null;
        },
        error: (): string | null => null,
    };
}

export function error(): string | null {
    return null;
}
