/**
 * System logging functions
 *
 * The `log` module provides bindings to the POSIX `openlog()`, `syslog()`
 * and `closelog()` functions as well as, when available, the OpenWrt
 * specific ulog library functions.
 *
 * @example
 * import { openlog, syslog, LOG_PID, LOG_USER, LOG_ERR } from 'log';
 * openlog("my-log-ident", LOG_PID, LOG_USER);
 * syslog(LOG_ERR, "An error occurred!");
 *
 * import { ulog_open, ulog, ULOG_SYSLOG, LOG_DAEMON, LOG_INFO } from 'log';
 * ulog_open(ULOG_SYSLOG, LOG_DAEMON, "my-log-ident");
 * ulog(LOG_INFO, "The current epoch is %d", time());
 *
 * @see https://ucode.mein.io/module-log.html
 */
declare module "log" {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    /** Syslog facility names. */
    export type LogFacility =
        | "auth"
        | "authpriv"
        | "cron"
        | "daemon"
        | "ftp"
        | "kern"
        | "lpr"
        | "mail"
        | "news"
        | "syslog"
        | "user"
        | "uucp"
        | "local0"
        | "local1"
        | "local2"
        | "local3"
        | "local4"
        | "local5"
        | "local6"
        | "local7";

    /**
     * Syslog option names:
     * - `pid`: include PID with each message.
     * - `cons`: log to console if an error occurs while sending to syslog.
     * - `ndelay`: open the connection to the logger immediately.
     * - `odelay`: delay open until the first message is logged.
     * - `nowait`: do not wait for child processes created during logging.
     */
    export type LogOption = "pid" | "cons" | "ndelay" | "odelay" | "nowait";

    /** Syslog priority names, from most to least severe. */
    export type LogPriority =
        | "emerg"
        | "alert"
        | "crit"
        | "err"
        | "warning"
        | "notice"
        | "info"
        | "debug";

    /**
     * Ulog channel names:
     * - `kmsg`: log to `/dev/kmsg`, messages appear in dmesg.
     * - `syslog`: use the standard syslog mechanism.
     * - `stdio`: log to stderr.
     */
    export type UlogChannel = "kmsg" | "syslog" | "stdio";

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /** Option: include PID with each message. */
    export const LOG_PID: number;
    /** Option: log to console if an error occurs while sending to syslog. */
    export const LOG_CONS: number;
    /** Option: open the connection to the logger immediately. */
    export const LOG_NDELAY: number;
    /** Option: delay open until the first message is logged. */
    export const LOG_ODELAY: number;
    /** Option: do not wait for child processes created during logging. */
    export const LOG_NOWAIT: number;

    /** Facility: authentication/authorization messages. */
    export const LOG_AUTH: number;
    /** Facility: private authentication messages. */
    export const LOG_AUTHPRIV: number;
    /** Facility: clock daemon (cron and at commands). */
    export const LOG_CRON: number;
    /** Facility: system daemons without separate facility values. */
    export const LOG_DAEMON: number;
    /** Facility: FTP server daemon. */
    export const LOG_FTP: number;
    /** Facility: kernel messages. */
    export const LOG_KERN: number;
    /** Facility: line printer subsystem. */
    export const LOG_LPR: number;
    /** Facility: mail system. */
    export const LOG_MAIL: number;
    /** Facility: network news subsystem. */
    export const LOG_NEWS: number;
    /** Facility: messages generated internally by syslogd. */
    export const LOG_SYSLOG: number;
    /** Facility: generic user-level messages. */
    export const LOG_USER: number;
    /** Facility: UUCP subsystem. */
    export const LOG_UUCP: number;
    /** Facility: local use 0. */
    export const LOG_LOCAL0: number;
    /** Facility: local use 1. */
    export const LOG_LOCAL1: number;
    /** Facility: local use 2. */
    export const LOG_LOCAL2: number;
    /** Facility: local use 3. */
    export const LOG_LOCAL3: number;
    /** Facility: local use 4. */
    export const LOG_LOCAL4: number;
    /** Facility: local use 5. */
    export const LOG_LOCAL5: number;
    /** Facility: local use 6. */
    export const LOG_LOCAL6: number;
    /** Facility: local use 7. */
    export const LOG_LOCAL7: number;

    /** Priority: system is unusable. */
    export const LOG_EMERG: number;
    /** Priority: action must be taken immediately. */
    export const LOG_ALERT: number;
    /** Priority: critical conditions. */
    export const LOG_CRIT: number;
    /** Priority: error conditions. */
    export const LOG_ERR: number;
    /** Priority: warning conditions. */
    export const LOG_WARNING: number;
    /** Priority: normal, but significant, condition. */
    export const LOG_NOTICE: number;
    /** Priority: informational message. */
    export const LOG_INFO: number;
    /** Priority: debug-level message. */
    export const LOG_DEBUG: number;

    /** Ulog channel: log messages to `/dev/kmsg` (dmesg). */
    export const ULOG_KMSG: number;
    /** Ulog channel: log messages to stdout. */
    export const ULOG_STDIO: number;
    /** Ulog channel: log messages to syslog. */
    export const ULOG_SYSLOG: number;

    // -----------------------------------------------------------------------
    // Syslog functions
    // -----------------------------------------------------------------------

    /**
     * Open a connection to the system logger and configure the default
     * identification and facility.
     *
     * Optional: the first `syslog()` call implicitly opens the connection
     * with the program name as ident and the `LOG_USER` facility.
     *
     * @param ident Defaults to the name of the calling process.
     * @param options A bitmask of `LOG_*` option constants, an option name
     * or an array of option names.
     * @param facility A `LOG_*` facility constant or name, defaults to
     * `"user"`.
     * @returns `false` if an unrecognized option or facility was given.
     * @example
     * openlog("myapp", LOG_PID | LOG_NDELAY, LOG_LOCAL0);
     * openlog("myapp", [ "pid", "ndelay" ], "user");
     */
    export function openlog(
        ident?: string,
        options?: number | LogOption | readonly LogOption[],
        facility?: number | LogFacility,
    ): boolean;

    /**
     * Log a message to the system logger, formatting it like `sprintf()`.
     *
     * A non-string, non-null `format` is stringified and logged as-is.
     *
     * @param priority A `LOG_*` priority constant (optionally OR-ed with a
     * facility constant) or a priority name.
     * @returns `false` if an invalid priority or an empty message was given.
     * @example
     * syslog(LOG_ERR, "User %s encountered error: %d", username, errorCode);
     * syslog(LOG_DEBUG | LOG_AUTHPRIV, "Authentication failed");
     * syslog("emerg", "System shutdown imminent!");
     * syslog("debug", { foo: 1, bar: true });
     */
    export function syslog(
        priority: number | LogPriority,
        format: unknown,
        ...args: unknown[]
    ): boolean;

    /**
     * Close the connection to the system logger. Usually not required.
     */
    export function closelog(): void;

    // -----------------------------------------------------------------------
    // Ulog functions (OpenWrt specific)
    // -----------------------------------------------------------------------

    /**
     * Configure the ulog logger, analogous to `openlog()`.
     *
     * OpenWrt specific, may not be present on other systems.
     *
     * The default channel is `"kmsg"` during preinit, `"stdio"` on
     * interactive terminals and `"syslog"` otherwise. The default facility
     * is `"daemon"` during preinit or without terminal, `"user"` otherwise.
     *
     * @param channel A bitmask of `ULOG_*` constants, a channel name or an
     * array of channel names.
     * @param facility A `LOG_*` facility constant or name.
     * @param ident Defaults to the name of the calling process.
     * @returns `false` if an unrecognized channel or facility was given.
     * @example
     * ulog_open([ "stdio", "kmsg" ], "daemon", "my-program");
     * ulog_open(ULOG_SYSLOG, LOG_LOCAL0);
     */
    export function ulog_open(
        channel?: number | UlogChannel | readonly UlogChannel[],
        facility?: number | LogFacility,
        ident?: string,
    ): boolean;

    /**
     * Log a message to all configured ulog channels, formatting it like
     * `sprintf()`. Messages less severe than the `ulog_threshold()` are
     * discarded.
     *
     * OpenWrt specific, may not be present on other systems.
     *
     * @param priority A `LOG_*` priority constant or a priority name.
     * @returns `false` if an invalid priority or an empty message was given.
     * @example
     * ulog(LOG_ERR, "User %s encountered error: %d", username, errorCode);
     * ulog("err", "General error encountered");
     */
    export function ulog(
        priority: number | LogPriority,
        format: unknown,
        ...args: unknown[]
    ): boolean;

    /**
     * Set the application wide priority threshold for `ulog()`. Defaults to
     * `LOG_DEBUG`, allowing all messages.
     *
     * OpenWrt specific, may not be present on other systems.
     *
     * @returns `false` if an invalid priority was given.
     * @example
     * ulog_threshold(LOG_WARNING);
     * ulog_threshold("debug");
     */
    export function ulog_threshold(priority?: number | LogPriority): boolean;

    /**
     * Reset ulog channels, facility and ident to their defaults. Usually not
     * required.
     *
     * OpenWrt specific, may not be present on other systems.
     */
    export function ulog_close(): void;

    /**
     * Log a message via `ulog()` with `LOG_ERR` priority.
     *
     * @example
     * ERR("This is an error!");
     */
    export function ERR(format: unknown, ...args: unknown[]): boolean;

    /**
     * Log a message via `ulog()` with `LOG_WARNING` priority.
     *
     * @example
     * WARN("This is a warning");
     */
    export function WARN(format: unknown, ...args: unknown[]): boolean;

    /**
     * Log a message via `ulog()` with `LOG_NOTICE` priority.
     *
     * @example
     * NOTE("This is a notification log message");
     */
    export function NOTE(format: unknown, ...args: unknown[]): boolean;

    /**
     * Log a message via `ulog()` with `LOG_INFO` priority.
     *
     * @example
     * INFO("This is an info log message");
     */
    export function INFO(format: unknown, ...args: unknown[]): boolean;
}
