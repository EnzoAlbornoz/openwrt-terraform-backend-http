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
 *   a syscall. Each response is written with a single `uhttpd.send()` call
 *   whose arguments are `fwrite()` one after another, so headers and body are
 *   never concatenated into an intermediate string.
 * - uhttpd parses the CGI headers itself. `Status:` is only honored in the
 *   exact `NNN Reason` form (otherwise the response silently becomes
 *   `200 OK`), and without `Content-Length` an HTTP/1.1 response is re-encoded
 *   with chunked transfer encoding, so `Content-Length` is always sent (except
 *   for 204/304, which uhttpd never chunks).
 * - The request body is read from stdin with `uhttpd.recv(n)`, which loops
 *   internally until it has `n` bytes or a read comes up short. Its default
 *   `n` is `BUFSIZ` (1 KiB on musl), so the remaining length is always passed
 *   explicitly to keep the number of calls down.
 * - Uncaught exceptions are answered by uhttpd with a 500 that includes the
 *   script path and source context; `serve()` answers them itself instead.
 *
 * @see https://github.com/openwrt/uhttpd/blob/master/ucode.c
 */

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
    /** Whether a response has been written. */
    sent: boolean;
}

export type HttpHandler = (req: HttpRequest) => void;

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
 * Read the request body. stdin can only be consumed once, so call this at
 * most once per request.
 *
 * Returns `null` if the body is larger than `maxLength` bytes (answer with
 * 413) or ended early because the client went away. A body larger than
 * `maxLength` is rejected from its `Content-Length` without being read.
 *
 * @param maxLength Maximum body size in bytes; must be an integer.
 */
export function readBody(req: HttpRequest, maxLength: number): string | null {
    const contentLength = req.env.CONTENT_LENGTH;
    let expected: number;

    if (contentLength != null) {
        expected = int(contentLength);

        if (expected > maxLength) return null;
    } else if (req.env.headers["transfer-encoding"] != null) {
        // Chunked: read one byte past the limit to detect an oversized body.
        expected = maxLength + 1;
    } else {
        return "";
    }

    let first: string | null = null;
    let chunks: string[] | null = null;
    let received = 0;

    while (received < expected) {
        const chunk = uhttpd.recv(expected - received);

        if (chunk == null) break;

        received += length(chunk);

        // Most bodies arrive in one chunk; only join when there are several,
        // since repeated `+=` would copy the body over and over.
        if (first == null) first = chunk;
        else if (chunks == null) chunks = [first, chunk];
        else push(chunks, chunk);
    }

    if (received > maxLength) return null;
    if (contentLength != null && received < expected) return null;

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
 * Write the response. `Content-Type` and `Content-Length` are set from the
 * arguments, so `headers` must not contain them (nor `Status`). For `HEAD`
 * requests the body is measured but not written.
 *
 * Dies if a response has already been written.
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
    if (req.sent) die("Response already sent");

    req.sent = true;

    const statusLine = STATUS_LINES[status];
    const extra = headers != null ? formatHeaders(headers) : null;

    if (body == null || body == "") {
        uhttpd.send(
            statusLine,
            extra,
            status == 204 || status == 304 ? "\r\n" : "Content-Length: 0\r\n\r\n",
        );
        return;
    }

    uhttpd.send(
        statusLine,
        "Content-Type: ",
        contentType ?? "application/octet-stream",
        "\r\nContent-Length: ",
        length(body),
        "\r\n",
        extra,
        "\r\n",
        req.method == "HEAD" ? null : body,
    );
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
