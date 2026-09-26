/**
 * Request/response helpers for the uhttpd ucode plugin.
 *
 * How uhttpd runs the handler (see uhttpd's ucode.c, proc.c and relay.c):
 *
 * - The script is compiled and executed once at startup; then every request
 *   forks a process that calls `handle_request()` and exits. Module-level
 *   work is therefore paid once and shared by all requests, so everything
 *   that can be precomputed (e.g. status lines) is built at load time.
 * - The response goes to stdout, which is fully buffered (8 KiB) and flushed
 *   by `exit()` after the callback returns: calling `uhttpd.flush()` only adds
 *   a syscall. Bodies are written as-is after the headers, never concatenated
 *   with them into an intermediate string.
 * - uhttpd parses the CGI headers itself. `Status:` is only honored in the
 *   exact `NNN Reason` form (otherwise the response silently becomes
 *   `200 OK`), and without `Content-Length` an HTTP/1.1 response is re-encoded
 *   with chunked transfer encoding, so `Content-Length` is sent whenever the
 *   length is known (except for 204/304, which uhttpd never chunks).
 * - The request body arrives on stdin, a blocking pipe that uhttpd closes once
 *   the body is complete. It is read with `fs.stdin.read(n)` rather than
 *   `uhttpd.recv(n)`: both return up to `n` bytes, but `recv()` issues one
 *   `read()` per `BUFSIZ` (1 KiB on musl) while `fread()` reads straight into
 *   its buffer, taking about one syscall per pipe write.
 * - Large bodies (Terraform states can be several MiB) are streamed in
 *   `CHUNK_SIZE` pieces in both directions, so memory use does not grow with
 *   the body size. `CHUNK_SIZE` is the default pipe capacity, the most either
 *   pipe can hold at once.
 * - Uncaught exceptions are answered by uhttpd with a 500 that includes the
 *   script path and source context; `serve()` answers them itself instead.
 *
 * @see https://github.com/openwrt/uhttpd/blob/master/ucode.c
 */

import { open, stdin } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Additional response headers. Names and values must not contain CR/LF. */
export type HttpHeaders = Record<string, string>;

/** A request, wrapping the environment uhttpd passes to `handle_request()`. */
export interface HttpRequest {
    /** The raw uhttpd environment; `env.headers` has lowercased names. */
    readonly env: UhttpdRequestEnv;
    readonly method: UhttpdRequestMethod;
    /** The path after the matched prefix, still URL-encoded, e.g. `/a/b`. */
    readonly path: string;
    /** Whether the response has been started. */
    sent: boolean;
}

export type HttpHandler = (req: HttpRequest) => void;

/**
 * Why a request body could not be consumed, as the status to answer with:
 * 413 if it exceeds the limit, 400 if it ended early (the client went away),
 * 500 if the `streamBody()` callback aborted.
 */
export type BodyError = 400 | 413 | 500;

/** Size of the pieces bodies are streamed in: the default pipe capacity. */
const CHUNK_SIZE = 65536;

// ---------------------------------------------------------------------------
// Status lines
// ---------------------------------------------------------------------------

const STATUSES = [
    [200, "OK"],
    [201, "Created"],
    [204, "No Content"],
    [304, "Not Modified"],
    [400, "Bad Request"],
    [401, "Unauthorized"],
    [403, "Forbidden"],
    [404, "Not Found"],
    [405, "Method Not Allowed"],
    [409, "Conflict"],
    [411, "Length Required"],
    [412, "Precondition Failed"],
    [413, "Content Too Large"],
    [415, "Unsupported Media Type"],
    [423, "Locked"],
    [500, "Internal Server Error"],
    [501, "Not Implemented"],
    [503, "Service Unavailable"],
] as const;

/** The status codes `send()` accepts. */
export type HttpStatus = (typeof STATUSES)[number][0];

/**
 * Complete `Status:` header lines indexed by status code. An array rather
 * than an object, so a lookup is a direct index instead of converting the
 * code to a string key.
 */
const STATUS_LINES: string[] = [];

for (let i = 0; i < length(STATUSES); i++) {
    const status = STATUSES[i] as (typeof STATUSES)[number];

    STATUS_LINES[status[0]] = "Status: " + status[0] + " " + status[1] + "\r\n";
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export function createRequest(env: UhttpdRequestEnv): HttpRequest {
    return {
        env,
        method: env.REQUEST_METHOD,
        path: env.PATH_INFO ?? "/",
        sent: false,
    };
}

/**
 * URL-decode a value, also turning `+` into a space when `plus` is set.
 * Returns `null` if it is malformed. The native decoder is only called when
 * there is something to decode.
 */
function decode(value: string, plus: boolean): string | null {
    let result = value;

    if (plus && index(result, "+") >= 0) result = replace(result, "+", " ");
    if (index(result, "%") < 0) return result;

    try {
        return uhttpd.urldecode(result);
    } catch {
        return null;
    }
}

/**
 * Split the request path into URL-decoded segments, ignoring empty ones
 * (`/a//b/` yields `["a", "b"]`). Returns `null` if a segment is malformed.
 *
 * Decoded segments may contain `/` or be `..`; validate them before using
 * them as file names.
 */
export function pathSegments(req: HttpRequest): string[] | null {
    const parts = split(req.path, "/");
    const segments: string[] = [];

    for (let i = 0; i < length(parts); i++) {
        const part = parts[i] as string;

        if (part == "") continue;

        const segment = decode(part, false);

        if (segment == null) return null;

        push(segments, segment);
    }

    return segments;
}

/**
 * Parse the query string. Keys without `=` map to `""`, and repeated keys
 * keep the last value. Returns `null` if it is malformed.
 */
export function query(req: HttpRequest): Record<string, string> | null {
    const params: Record<string, string> = {};
    const qs = req.env.QUERY_STRING;

    if (qs == null || qs == "") return params;

    const pairs = split(qs, "&");

    for (let i = 0; i < length(pairs); i++) {
        const pair = pairs[i] as string;

        if (pair == "") continue;

        const eq = index(pair, "=");
        const key = decode(eq < 0 ? pair : substr(pair, 0, eq), true);
        const value = eq < 0 ? "" : decode(substr(pair, eq + 1), true);

        if (key == null || value == null) return null;

        params[key] = value;
    }

    return params;
}

/**
 * Read the request body from stdin, passing it to `onChunk` in pieces of at
 * most `chunkSize` bytes. A body larger than `maxLength` is rejected from
 * its `Content-Length` without being read.
 */
function receive(
    req: HttpRequest,
    maxLength: number,
    chunkSize: number,
    onChunk: (chunk: string) => unknown,
): BodyError | null {
    const contentLength = req.env.CONTENT_LENGTH;
    let expected: number;

    if (contentLength != null) {
        expected = int(contentLength);

        if (expected > maxLength) return 413;
    } else if (req.env.headers["transfer-encoding"] != null) {
        // Chunked: read one byte past the limit to detect an oversized body.
        expected = maxLength + 1;
    } else {
        return null;
    }

    let received = 0;

    while (received < expected) {
        const remaining = expected - received;
        const chunk = stdin.read(remaining < chunkSize ? remaining : chunkSize);

        if (chunk == null || chunk == "") break;

        received += length(chunk);

        if (received > maxLength) return 413;
        if (onChunk(chunk) === false) return 500;
    }

    if (contentLength != null && received < expected) return 400;

    return null;
}

/**
 * Stream the request body to `onChunk` in pieces of at most `CHUNK_SIZE`
 * bytes, so memory use stays constant whatever the body size. Returning
 * `false` from `onChunk` aborts. stdin can only be consumed once, so call
 * this (or `readBody()`) at most once per request.
 *
 * On error, `onChunk` may already have received part of the body, so discard
 * what it wrote (e.g. delete the temporary file).
 *
 * @param maxLength Maximum body size in bytes; must be an integer.
 * @returns `null` once the whole body was consumed, else the status to answer
 *     with.
 * @example
 * const tmp = open(path + ".tmp", "w");
 * const err = streamBody(req, MAX_STATE_SIZE, function (chunk) {
 *     return tmp.write(chunk) == length(chunk);
 * });
 * tmp.close();
 * if (err != null) {
 *     unlink(path + ".tmp");
 *     send(req, err);
 *     return;
 * }
 * rename(path + ".tmp", path);
 */
export function streamBody(
    req: HttpRequest,
    maxLength: number,
    onChunk: (chunk: string) => unknown,
): BodyError | null {
    return receive(req, maxLength, CHUNK_SIZE, onChunk);
}

/**
 * Read the whole request body into memory, for small bodies (e.g. lock
 * info); use `streamBody()` for large ones. stdin can only be consumed once,
 * so call this (or `streamBody()`) at most once per request.
 *
 * A body with a `Content-Length` is read with a single `fread()` into a
 * buffer of exactly that size; a chunked one in `CHUNK_SIZE` pieces.
 *
 * @param maxLength Maximum body size in bytes; must be an integer.
 * @returns `null` if the body is larger than `maxLength` (answer with 413) or
 *     ended early because the client went away.
 */
export function readBody(req: HttpRequest, maxLength: number): string | null {
    let first: string | null = null;
    let chunks: string[] | null = null;

    const err = receive(
        req,
        maxLength,
        req.env.CONTENT_LENGTH != null ? maxLength + 1 : CHUNK_SIZE,
        function (chunk: string): void {
            // Most bodies arrive in one chunk; only join when there are
            // several, since repeated `+=` would copy the body over and over.
            if (first == null) first = chunk;
            else if (chunks == null) chunks = [first, chunk];
            else push(chunks, chunk);
        },
    );

    if (err != null) return null;

    return chunks != null ? join("", chunks) : (first ?? "");
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

function formatHeaders(headers: HttpHeaders): string {
    const names = keys(headers);
    let result = "";

    for (let i = 0; i < length(names); i++) {
        const name = names[i] as string;

        result += name + ": " + headers[name] + "\r\n";
    }

    return result;
}

/**
 * Start a response by writing its status line and headers; the body follows
 * with `writeBody()`. `headers` must not contain `Status`, `Content-Type` or
 * `Content-Length`.
 *
 * With a `contentLength`, exactly that many bytes must be written, or the
 * connection gets out of sync. Without one, uhttpd frames the body with
 * chunked transfer encoding, which costs a little more on the wire.
 *
 * Dies if a response has already been started.
 */
export function writeHead(
    req: HttpRequest,
    status: HttpStatus,
    contentLength: number | null,
    contentType?: string | null,
    headers?: HttpHeaders | null,
): void {
    if (req.sent) die("Response already sent");

    req.sent = true;

    uhttpd.send(
        STATUS_LINES[status],
        contentType != null ? "Content-Type: " + contentType + "\r\n" : null,
        contentLength != null && status != 204 && status != 304
            ? "Content-Length: " + contentLength + "\r\n"
            : null,
        headers != null ? formatHeaders(headers) : null,
        "\r\n",
    );
}

/**
 * Write a piece of the response body, after `writeHead()`. It is written
 * straight to stdout without being copied. Does nothing for `HEAD` requests.
 */
export function writeBody(req: HttpRequest, chunk: string): void {
    if (!req.sent) die("writeHead() must be called before writeBody()");

    if (req.method != "HEAD") uhttpd.send(chunk);
}

/**
 * Write a complete response. For `HEAD` requests the body is measured but
 * not written.
 *
 * @param contentType Defaults to `application/octet-stream` when there is a
 *     body; ignored when there is none.
 */
export function send(
    req: HttpRequest,
    status: HttpStatus,
    body?: string | null,
    contentType?: string | null,
    headers?: HttpHeaders | null,
): void {
    if (body == null || body == "") {
        writeHead(req, status, 0, null, headers);
        return;
    }

    writeHead(req, status, length(body), contentType ?? "application/octet-stream", headers);
    writeBody(req, body);
}

/** Write `value` as a JSON response. */
export function sendJson(
    req: HttpRequest,
    status: HttpStatus,
    value: unknown,
    headers?: HttpHeaders | null,
): void {
    send(req, status, sprintf("%J", value), "application/json", headers);
}

/**
 * Stream a file as the response body in `CHUNK_SIZE` pieces, so memory use
 * does not depend on the file size. For `HEAD` requests the file is only
 * measured.
 *
 * The length is taken from the opened file, so replace files by renaming a
 * new one over them rather than rewriting them in place: a file that shrinks
 * while it is sent cannot be answered correctly anymore (this dies).
 *
 * @returns `false`, with nothing written, if the file cannot be opened.
 */
export function sendFile(
    req: HttpRequest,
    status: HttpStatus,
    path: string,
    contentType?: string | null,
    headers?: HttpHeaders | null,
): boolean {
    const file = open(path, "r");

    if (file == null) return false;

    file.seek(0, 2);

    const size = file.tell();

    if (size == null) {
        file.close();
        die("Cannot determine the size of " + path);
    }

    file.seek(0, 0);
    writeHead(req, status, size, contentType ?? "application/octet-stream", headers);

    let remaining = req.method == "HEAD" ? 0 : size;

    while (remaining > 0) {
        const chunk = file.read(remaining < CHUNK_SIZE ? remaining : CHUNK_SIZE);

        if (chunk == null || chunk == "") break;

        uhttpd.send(chunk);
        remaining -= length(chunk);
    }

    file.close();

    if (remaining > 0) die(path + " was truncated while being sent");

    return true;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Wrap a handler as uhttpd's `handle_request()` callback. Exceptions are
 * logged to stderr and answered with a bare 500 instead of uhttpd's report
 * (which exposes the script path and source), and a handler that writes no
 * response gets a 500 instead of uhttpd's 502.
 *
 * @example
 * global.handle_request = serve(function (req) {
 *     send(req, 204);
 * });
 */
export function serve(handler: HttpHandler): UhttpdRequestHandler {
    return function (env: UhttpdRequestEnv): void {
        const req = createRequest(env);

        try {
            handler(req);
        } catch (err) {
            const ex = err as UcodeException;

            warn("Unhandled ", ex.type, ": ", ex.message, "\n");
        }

        if (!req.sent) send(req, 500);
    };
}
