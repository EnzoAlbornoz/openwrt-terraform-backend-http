/**
 * A Node stand-in for ucode's `log` module: `syslog()` records the messages
 * in `messages`, instead of sending them to the system logger.
 *
 * @see https://ucode-lang.org/module-log.html
 */

export const LOG_AUTHPRIV = 10 << 3;
export const LOG_NOTICE = 5;

export interface LogMessage {
    ident: string | null;
    facility: number | null;
    priority: number;
    message: string;
}

/** The messages logged so far; tests clear it with `messages.splice(0)`. */
export const messages: LogMessage[] = [];

let ident: string | null = null;
let facility: number | null = null;

export function openlog(name?: string, _options?: number, fac?: number): boolean {
    ident = name ?? null;
    facility = fac ?? null;

    return true;
}

export function syslog(priority: number, format: unknown, ...args: unknown[]): boolean {
    const sprintf = (globalThis as unknown as { sprintf: (...a: unknown[]) => string }).sprintf;

    messages.push({ ident, facility, priority, message: sprintf(format, ...args) });

    return true;
}

export function closelog(): void {
    ident = null;
    facility = null;
}
