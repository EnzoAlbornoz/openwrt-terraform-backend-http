/**
 * Type definitions for the uhttpd ucode integration.
 *
 * uhttpd loads the handler script once per configured prefix (`ucode_prefix`
 * option), then forks a process for every matching request and invokes the
 * global `handle_request()` callback in it. The response is written to
 * stdout in CGI format: header lines (e.g. `Status: 200 OK`,
 * `Content-Type: text/plain`), an empty line, then the body.
 *
 * Notes on the runtime:
 * - The handler is compiled in template mode (`raw_mode: false`) with
 *   `lstrip_blocks` and `trim_blocks` enabled, so it must start with `{%`.
 * - Output produced while loading the script is discarded, and calling
 *   `exit()` during loading aborts uhttpd.
 * - Each request runs in a forked process, so state changed by a request
 *   does not persist to the next one.
 * - Uncaught exceptions are answered with `500 Internal Server Error`.
 *
 * @example
 * global.handle_request = function(env) {
 *     uhttpd.send("Status: 200 OK\r\n");
 *     uhttpd.send("Content-Type: text/plain\r\n\r\n");
 *     uhttpd.send("Hello from ", env.REQUEST_URI, "\n");
 * };
 *
 * @see https://github.com/openwrt/uhttpd/blob/master/ucode.c
 */

/// <reference path="../index.d.ts" />

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** HTTP methods accepted by uhttpd. */
type UhttpdRequestMethod = "GET" | "POST" | "HEAD" | "OPTIONS" | "PUT" | "PATCH" | "DELETE";

/** HTTP protocol versions accepted by uhttpd. */
type UhttpdServerProtocol = "HTTP/0.9" | "HTTP/1.0" | "HTTP/1.1";

/**
 * The request headers. Header names are lowercased by uhttpd; the special
 * `URL` key holds the raw request URL.
 */
interface UhttpdRequestHeaders {
    /** The raw request URL, including the query string. */
    URL: string;
    accept?: string;
    "accept-charset"?: string;
    "accept-encoding"?: string;
    "accept-language"?: string;
    authorization?: string;
    connection?: string;
    "content-length"?: string;
    "content-type"?: string;
    cookie?: string;
    host?: string;
    origin?: string;
    referer?: string;
    "user-agent"?: string;
    [name: string]: string | undefined;
}

/**
 * The request environment passed to `handle_request()`. Mirrors the CGI
 * environment of uhttpd; variables without value are omitted.
 */
interface UhttpdRequestEnv {
    /** Always `"CGI/1.1"`. */
    GATEWAY_INTERFACE: string;
    /** Always `"uhttpd"`. */
    SERVER_SOFTWARE: string;
    /** The matched `ucode_prefix`. */
    SCRIPT_NAME: string;
    /** The path of the handler script. */
    SCRIPT_FILENAME: string;
    /** The document root, if known. */
    DOCUMENT_ROOT?: string;
    /** The query string without leading `?`, empty if there is none. */
    QUERY_STRING: string;
    /** The request URL, including the query string. */
    REQUEST_URI: string;
    /** The request protocol. */
    SERVER_PROTOCOL: UhttpdServerProtocol;
    /** The request method. */
    REQUEST_METHOD: UhttpdRequestMethod;
    /** The request path after the matched prefix, without query string. */
    PATH_INFO?: string;
    /** The authenticated user, when basic authentication is configured. */
    REMOTE_USER?: string;
    /** `"on"` for TLS connections. */
    HTTPS?: "on";
    /** The redirect status code, as string (e.g. `"200"`). */
    REDIRECT_STATUS: string;
    /** The local address the request was received on. */
    SERVER_NAME: string;
    /** The local address the request was received on. */
    SERVER_ADDR: string;
    /** The local port the request was received on. */
    SERVER_PORT: string;
    /** The remote address. */
    REMOTE_HOST: string;
    /** The remote address. */
    REMOTE_ADDR: string;
    /** The remote port. */
    REMOTE_PORT: string;

    /** Value of the `Accept` header. */
    HTTP_ACCEPT?: string;
    /** Value of the `Accept-Charset` header. */
    HTTP_ACCEPT_CHARSET?: string;
    /** Value of the `Accept-Encoding` header. */
    HTTP_ACCEPT_ENCODING?: string;
    /** Value of the `Accept-Language` header. */
    HTTP_ACCEPT_LANGUAGE?: string;
    /** Value of the `Authorization` header. */
    HTTP_AUTHORIZATION?: string;
    /** Value of the `Connection` header. */
    HTTP_CONNECTION?: string;
    /** Value of the `Cookie` header. */
    HTTP_COOKIE?: string;
    /** Value of the `Host` header. */
    HTTP_HOST?: string;
    /** Value of the `Origin` header. */
    HTTP_ORIGIN?: string;
    /** Value of the `Referer` header. */
    HTTP_REFERER?: string;
    /** Value of the `User-Agent` header. */
    HTTP_USER_AGENT?: string;
    /** Value of the `X-HTTP-Method-Override` header. */
    HTTP_X_HTTP_METHOD_OVERRIDE?: string;
    /** Value of the `HTTP-Auth-User` header. */
    HTTP_AUTH_USER?: string;
    /** Value of the `HTTP-Auth-Pass` header. */
    HTTP_AUTH_PASS?: string;
    /** Value of the `Content-Type` header. */
    CONTENT_TYPE?: string;
    /** Value of the `Content-Length` header. */
    CONTENT_LENGTH?: string;

    /** The HTTP version as number: `0.9`, `1.0` or `1.1`. */
    HTTP_VERSION: number;
    /** All request headers. */
    headers: UhttpdRequestHeaders;
}

/**
 * The request callback the handler script must define as global
 * `handle_request`. Its return value is ignored.
 */
type UhttpdRequestHandler = (env: UhttpdRequestEnv) => unknown;

/** The `uhttpd` API table available to handler scripts. */
interface Uhttpd {
    /**
     * Write the given values to the client. Strings are written as-is,
     * other non-null values are stringified like `print()` does.
     *
     * @returns The number of bytes written.
     * @example
     * uhttpd.send("Status: 200 OK\r\nContent-Type: text/plain\r\n\r\n");
     * uhttpd.send("Hello ", name, "\n");
     */
    send(...values: unknown[]): number;

    /** Alias of `send()`. */
    sendc(...values: unknown[]): number;

    /**
     * Read up to `length` bytes (default `BUFSIZ`) of the request body from
     * stdin.
     *
     * @returns The read data, or `null` on EOF or error.
     * @example
     * let body = "";
     * for (let chunk = uhttpd.recv(4096); chunk != null; chunk = uhttpd.recv(4096))
     *     body += chunk;
     */
    recv(length?: number): string | null;

    /** Flush buffered output to the client. */
    flush(): null;

    /**
     * URL-decode a value (converted to string first, `null` yields `""`).
     *
     * Throws on malformed input or if the result exceeds 4096 bytes.
     */
    urldecode(value: unknown): string;

    /**
     * URL-encode a value (converted to string first, `null` yields `""`).
     *
     * Throws if the result exceeds 4096 bytes.
     */
    urlencode(value: unknown): string;

    /** The document root configured in uhttpd. */
    docroot: string;
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

interface UcodeGlobal {
    /** The uhttpd API table. */
    uhttpd: Uhttpd;
    /**
     * The request callback invoked by uhttpd for every request. The handler
     * script must define it, otherwise uhttpd refuses to start.
     *
     * @example
     * global.handle_request = function(env) {
     *     uhttpd.send("Status: 204 No Content\r\n\r\n");
     * };
     */
    handle_request: UhttpdRequestHandler;
}

/** The uhttpd API table. */
declare const uhttpd: Uhttpd;
