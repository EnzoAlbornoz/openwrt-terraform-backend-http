/**
 * A small h3-style HTTP framework for the uhttpd ucode plugin.
 *
 * @example
 * const app = createApp()
 *     .get("/hello/:name", function (event) {
 *         return "Hello, " + getRouterParam(event, "name", { decode: true }) + "!";
 *     })
 *     .post("/echo", function (event) {
 *         return readBody(event); // parsed JSON, sent back as JSON
 *     });
 *
 * serve(app);
 *
 * Differences from h3, due to ucode and uhttpd:
 *
 * - No classes, `new` or `throw`: `createApp()` builds the app and
 *   `throwHTTPError()` aborts a request with an error response.
 * - No promises: handlers and utilities are synchronous.
 * - Routes are relative to the uhttpd prefix (`ucode_prefix`), and
 *   `event.url.pathname` is the path after it.
 * - `event.req.headers` and `event.res.headers` are plain objects. Request
 *   header names are lowercase; use lowercase names for response headers too.
 * - Returning an `fs` file handle streams the file (like h3's `File`).
 *
 * How uhttpd runs the handler (see uhttpd's ucode.c, proc.c and relay.c),
 * which shapes the implementation:
 *
 * - The script is compiled and executed once at startup; then every request
 *   forks a process that calls `handle_request()` and exits. Everything done
 *   at load time (registering routes, building the router, precomputing
 *   status lines) is paid once and shared by all requests.
 * - The response goes to stdout, which is fully buffered (8 KiB) and flushed
 *   by `exit()` after the callback returns. Bodies are written as-is after the
 *   headers, never concatenated with them into an intermediate string.
 * - uhttpd parses the CGI headers itself. `Status:` is only honored in the
 *   exact `NNN Reason` form (otherwise the response silently becomes
 *   `200 OK`), and without `Content-Length` an HTTP/1.1 response is re-encoded
 *   with chunked transfer encoding, so `Content-Length` is always sent (except
 *   for 204/304, which uhttpd never chunks).
 * - The request body arrives on stdin, a blocking pipe that uhttpd closes once
 *   the body is complete. It is read with `fs.stdin.read(n)` rather than
 *   `uhttpd.recv(n)`: both return up to `n` bytes, but `recv()` issues one
 *   `read()` per `BUFSIZ` (1 KiB on musl) while `fread()` reads straight into
 *   its buffer, taking about one syscall per pipe write.
 * - Large bodies (Terraform states can be several MiB) can be streamed in
 *   `CHUNK_SIZE` pieces in both directions (`readBodyStream()`, returning a
 *   file), so memory use does not grow with the body size.
 * - Uncaught exceptions would be answered by uhttpd with a 500 that includes
 *   the script path and source context; the app answers them itself instead.
 *
 * @see https://h3.dev
 * @see https://github.com/openwrt/uhttpd/blob/master/ucode.c
 */

import { stdin, type FileHandle } from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Carries the incoming request, the prepared response and the context
 * through middleware and handlers.
 */
export interface H3Event {
    /** The incoming request. */
    readonly req: {
        readonly method: UhttpdRequestMethod;
        /** The request URL as received, including the query string. */
        readonly url: string;
        /** Request headers, with lowercase names. */
        readonly headers: UhttpdRequestHeaders;
    };
    /** The request path after the uhttpd prefix, still URL-encoded. */
    readonly url: {
        readonly pathname: string;
        /** The query string with its leading `?`, or `""`. */
        readonly search: string;
    };
    /**
     * The prepared response status and headers, applied to the value the
     * handler returns. Discarded when an error is thrown.
     */
    readonly res: {
        status: number;
        statusText: string | null;
        /** Use lowercase names; `content-type` overrides the default type. */
        headers: Record<string, string>;
    };
    /** Arbitrary per-request data shared between middleware and handlers. */
    readonly context: H3EventContext;
    /** The raw uhttpd request environment. */
    readonly env: UhttpdRequestEnv;
}

export interface H3EventContext {
    /** Matched route params, still URL-encoded (see `getRouterParams()`). */
    params: Record<string, string>;
    [key: string]: unknown;
}

/**
 * Receives the event and returns the response body:
 *
 * - a string: sent as `text/plain;charset=UTF-8`;
 * - an `fs` file handle: the whole file is streamed, then the handle closed;
 * - `null` (or no return): an empty body;
 * - anything else: serialized as `application/json;charset=UTF-8`.
 */
export type EventHandler = (event: H3Event) => unknown;

/**
 * Runs before the route handler. Returning a value other than `null` ends
 * the request with it as the response; `next()` runs the rest of the chain
 * and returns the handler's value.
 */
export type Middleware = (event: H3Event, next: () => unknown) => unknown;

export interface HTTPError {
    status: number;
    statusText: string | null;
    message: string;
    /** Sent under `data` in the JSON error body. */
    data: unknown;
    headers: Record<string, string> | null;
    /** Whether it comes from an unexpected exception. */
    unhandled: boolean;
    /** The exception behind an unhandled error. */
    cause: UcodeException | null;
}

export interface HTTPErrorOptions {
    statusText?: string;
    data?: unknown;
    headers?: Record<string, string>;
}

export interface H3Options {
    /** Called first for every request. */
    onRequest?: (event: H3Event) => void;
    /** Called for every error, before the error response is sent. */
    onError?: (error: HTTPError, event: H3Event) => void;
    /** Don't log unhandled errors to stderr. */
    silent?: boolean;
    /**
     * Include the message and stack trace of unhandled errors in responses.
     * Development only.
     */
    debug?: boolean;
}

export interface H3 {
    /** Register a route handler for `method` (uppercase). */
    on(method: string, route: string, handler: EventHandler): H3;
    /** Register a route handler for any method. */
    all(route: string, handler: EventHandler): H3;
    /** Register a GET route handler; it also answers HEAD requests. */
    get(route: string, handler: EventHandler): H3;
    post(route: string, handler: EventHandler): H3;
    put(route: string, handler: EventHandler): H3;
    patch(route: string, handler: EventHandler): H3;
    delete(route: string, handler: EventHandler): H3;
    head(route: string, handler: EventHandler): H3;
    options(route: string, handler: EventHandler): H3;
    /** Register a global middleware; they run in registration order. */
    use(middleware: Middleware): H3;
    /** Handle a request; this is uhttpd's `handle_request()` callback. */
    handler: UhttpdRequestHandler;
}

/** Internal per-request state. */
interface EventState extends H3Event {
    sent: boolean;
    bodyRead: boolean;
    bodyLimit: number;
    disposers: (() => void)[] | null;
}

interface Route {
    handler: EventHandler;
    /** `[segment index, name]` of each param. */
    params: [number, string][];
    /** Segment index a `**` wildcard starts at, or -1. */
    wildcard: number;
    wildcardName: string;
}

interface RouteNode {
    children: Record<string, RouteNode>;
    param: RouteNode | null;
    wildcard: RouteNode | null;
    /** Routes ending at this node by method; `""` matches any method. */
    methods: Record<string, Route> | null;
}

/** Size of the pieces bodies are streamed in: the default pipe capacity. */
const CHUNK_SIZE = 65536;

// ---------------------------------------------------------------------------
// Status lines
// ---------------------------------------------------------------------------

const STATUSES = [
    [200, "OK"],
    [201, "Created"],
    [202, "Accepted"],
    [204, "No Content"],
    [301, "Moved Permanently"],
    [302, "Found"],
    [304, "Not Modified"],
    [307, "Temporary Redirect"],
    [308, "Permanent Redirect"],
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
    [422, "Unprocessable Content"],
    [423, "Locked"],
    [429, "Too Many Requests"],
    [500, "Internal Server Error"],
    [501, "Not Implemented"],
    [502, "Bad Gateway"],
    [503, "Service Unavailable"],
] as const;

/**
 * Reason phrases and complete `Status:` header lines, indexed by status
 * code. Arrays rather than objects, so a lookup is a direct index instead of
 * converting the code to a string key.
 */
const REASONS: string[] = [];
const STATUS_LINES: string[] = [];

for (let i = 0; i < length(STATUSES); i++) {
    const status = STATUSES[i] as (typeof STATUSES)[number];

    REASONS[status[0]] = status[1];
    STATUS_LINES[status[0]] = "Status: " + status[0] + " " + status[1] + "\r\n";
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

// `die()` only carries a message, so the error travels beside it; the
// message identifies the exception it belongs to.
let thrownError: HTTPError | null = null;
let thrownMessage: string | null = null;

/**
 * Abort the request with an error response, like h3's
 * `throw new HTTPError(...)`. The body is JSON:
 * `{ status, statusText, message, data }`.
 *
 * @param message Defaults to the status reason phrase.
 * @example
 * throwHTTPError(423, "State is locked", { data: lockInfo });
 */
export function throwHTTPError(
    status: number,
    message?: string | null,
    options?: HTTPErrorOptions | null,
): never {
    thrownError = {
        status,
        statusText: options?.statusText ?? null,
        message: message ?? REASONS[status] ?? "Error",
        data: options?.data ?? null,
        headers: options?.headers ?? null,
        unhandled: false,
        cause: null,
    };
    thrownMessage = "HTTPError " + status + ": " + thrownError.message;

    die(thrownMessage);
}

function toHTTPError(ex: UcodeException): HTTPError {
    if (thrownError != null && ex.message == thrownMessage) return thrownError;

    return {
        status: 500,
        statusText: null,
        message: ex.message,
        data: null,
        headers: null,
        unhandled: true,
        cause: ex,
    };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function newNode(): RouteNode {
    return { children: {}, param: null, wildcard: null, methods: null };
}

/** Split a path into its non-empty segments. */
function segmentsOf(path: string): string[] {
    const parts = split(path, "/");
    const segments: string[] = [];

    for (let i = 0; i < length(parts); i++) {
        const part = parts[i] as string;

        if (part != "") push(segments, part);
    }

    return segments;
}

/**
 * Add a route to the tree. Patterns support static segments, `:name` and
 * `*` (params named `_0`, `_1`, ...) for one segment, and a final `**` or
 * `**:name` for any number of segments (param `_` or `name`).
 */
function addRoute(root: RouteNode, method: string, pattern: string, handler: EventHandler): void {
    const segments = segmentsOf(pattern);
    const params: [number, string][] = [];
    let wildcard = -1;
    let wildcardName = "_";
    let unnamed = 0;
    let node = root;

    for (let i = 0; i < length(segments); i++) {
        const segment = segments[i] as string;

        if (substr(segment, 0, 2) == "**") {
            if (i != length(segments) - 1) die("Route " + pattern + ": `**` must come last");
            if (substr(segment, 2, 1) == ":") wildcardName = substr(segment, 3);

            wildcard = i;

            if (node.wildcard == null) node.wildcard = newNode();

            node = node.wildcard;
            break;
        }

        if (segment == "*" || substr(segment, 0, 1) == ":") {
            push(params, [i, segment == "*" ? "_" + unnamed++ : substr(segment, 1)]);

            if (node.param == null) node.param = newNode();

            node = node.param;
            continue;
        }

        let child = node.children[segment];

        if (child == null) {
            child = newNode();
            node.children[segment] = child;
        }

        node = child;
    }

    if (node.methods == null) node.methods = {};

    node.methods[method] = { handler, params, wildcard, wildcardName };
}

/** The route of `node` for `method`; HEAD falls back to GET. */
function pickRoute(node: RouteNode, method: string, state: { allowed: RouteNode | null }) {
    const methods = node.methods;

    if (methods == null) return null;

    const route =
        methods[method] ?? (method == "HEAD" ? methods["GET"] : null) ?? methods[""] ?? null;

    if (route == null && state.allowed == null) state.allowed = node;

    return route;
}

/**
 * Find the route matching `segments` from index `i`, preferring static
 * segments over params over wildcards. `state.allowed` receives the first
 * node matching the path but not the method, for 405 responses.
 */
function findRoute(
    node: RouteNode,
    segments: string[],
    i: number,
    method: string,
    state: { allowed: RouteNode | null },
): Route | null {
    let route: Route | null = null;

    if (i == length(segments)) {
        route = pickRoute(node, method, state);
    } else {
        const child = node.children[segments[i] as string];

        if (child != null) route = findRoute(child, segments, i + 1, method, state);
        if (route == null && node.param != null)
            route = findRoute(node.param, segments, i + 1, method, state);
    }

    if (route == null && node.wildcard != null) route = pickRoute(node.wildcard, method, state);

    return route;
}

function routeParams(route: Route, segments: string[]): Record<string, string> {
    const params: Record<string, string> = {};

    for (let i = 0; i < length(route.params); i++) {
        const param = route.params[i] as [number, string];

        params[param[1]] = segments[param[0]] as string;
    }

    if (route.wildcard >= 0)
        params[route.wildcardName] = join("/", slice(segments, route.wildcard));

    return params;
}

function allowHeader(node: RouteNode): string {
    const methods = keys(node.methods ?? {});

    if (index(methods, "GET") >= 0 && index(methods, "HEAD") < 0) push(methods, "HEAD");

    return join(", ", methods);
}

// ---------------------------------------------------------------------------
// Request utilities
// ---------------------------------------------------------------------------

/**
 * URL-decode a value, also turning `+` into a space when `plus` is set. The
 * native decoder is only called when there is something to decode.
 */
function decode(value: string, plus: boolean): string {
    let result = value;

    if (plus && index(result, "+") >= 0) result = replace(result, "+", " ");
    if (index(result, "%") < 0) return result;

    try {
        return uhttpd.urldecode(result);
    } catch {
        throwHTTPError(400, "Malformed URL encoding");
    }
}

function parseQuery(qs: string): Record<string, string> {
    const params: Record<string, string> = {};
    const pairs = split(qs, "&");

    for (let i = 0; i < length(pairs); i++) {
        const pair = pairs[i] as string;

        if (pair == "") continue;

        const eq = index(pair, "=");

        if (eq < 0) params[decode(pair, true)] = "";
        else params[decode(substr(pair, 0, eq), true)] = decode(substr(pair, eq + 1), true);
    }

    return params;
}

/**
 * Get the parsed query string. Repeated keys keep the last value. Throws a
 * 400 error on malformed encoding.
 */
export function getQuery(event: H3Event): Record<string, string> {
    const qs = event.env.QUERY_STRING;

    return qs == null || qs == "" ? {} : parseQuery(qs);
}

/**
 * Decode a route param once, keeping encoded path separators (`%2f`, `%5c`)
 * encoded so decoding cannot introduce a `/` or `\` the router never saw.
 */
function decodeParam(value: string): string {
    if (index(value, "%") < 0) return value;

    return decode(replace(value, /%(2[fF]|5[cC])/g, "%25$1"), false);
}

/**
 * Get the matched route params, still URL-encoded unless `decode` is set.
 * Decoded params can still be `..`; validate them before using them as file
 * names. Throws a 400 error on malformed encoding.
 */
export function getRouterParams(
    event: H3Event,
    options?: { decode?: boolean } | null,
): Record<string, string> {
    const params = event.context.params;

    if (options?.decode != true) return params;

    const decoded: Record<string, string> = {};
    const names = keys(params);

    for (let i = 0; i < length(names); i++) {
        const name = names[i] as string;

        decoded[name] = decodeParam(params[name] as string);
    }

    return decoded;
}

/** Get a matched route param by name; see `getRouterParams()`. */
export function getRouterParam(
    event: H3Event,
    name: string,
    options?: { decode?: boolean } | null,
): string | null {
    const value = event.context.params[name];

    if (value == null) return null;

    return options?.decode == true ? decodeParam(value) : value;
}

/**
 * Limit the request body size. A body whose `Content-Length` exceeds `limit`
 * is rejected right away with a 413 error, without being read; a chunked one
 * as soon as reading it passes the limit.
 *
 * @param limit Maximum size in bytes; must be an integer.
 */
export function assertBodySize(event: H3Event, limit: number): void {
    const contentLength = event.env.CONTENT_LENGTH;

    (event as EventState).bodyLimit = limit;

    if (contentLength != null && int(contentLength) > limit) throwHTTPError(413);
}

/**
 * Read the request body from stdin, passing it to `onChunk` in pieces of at
 * most `chunkSize` bytes (0: as large as possible).
 */
function receive(event: EventState, chunkSize: number, onChunk: (chunk: string) => void): void {
    if (event.bodyRead) die("The request body can only be read once");

    event.bodyRead = true;

    const limit = event.bodyLimit;
    const contentLength = event.env.CONTENT_LENGTH;
    let expected: number;

    if (contentLength != null) {
        expected = int(contentLength);

        if (limit >= 0 && expected > limit) throwHTTPError(413);
    } else if (event.req.headers["transfer-encoding"] != null) {
        // Chunked: read until EOF, or one byte past the limit to detect an
        // oversized body.
        expected = limit >= 0 ? limit + 1 : -1;
    } else {
        return;
    }

    const size = chunkSize > 0 ? chunkSize : contentLength != null ? expected : CHUNK_SIZE;
    let received = 0;

    while (expected < 0 || received < expected) {
        const remaining = expected - received;
        const chunk = stdin.read(expected >= 0 && remaining < size ? remaining : size);

        if (chunk == null || chunk == "") break;

        received += length(chunk);

        if (limit >= 0 && received > limit) throwHTTPError(413);

        onChunk(chunk);
    }

    if (contentLength != null && received < expected) throwHTTPError(400, "Incomplete body");
}

/**
 * Read the request body as a string, or `null` if there is none. A body with
 * a `Content-Length` is read with a single `fread()` into a buffer of exactly
 * that size. For large bodies, prefer `readBodyStream()`.
 *
 * The body can only be read once. Call `assertBodySize()` first to limit it.
 */
export function readRawBody(event: H3Event): string | null {
    let first: string | null = null;
    let chunks: string[] | null = null;

    receive(event as EventState, 0, function (chunk: string): void {
        // Most bodies arrive in one chunk; only join when there are several,
        // since repeated `+=` would copy the body over and over.
        if (first == null) first = chunk;
        else if (chunks == null) chunks = [first, chunk];
        else push(chunks, chunk);
    });

    return chunks != null ? join("", chunks) : first;
}

/**
 * Read and parse the request body: URL-encoded form data for
 * `application/x-www-form-urlencoded`, JSON otherwise. Returns `null` if
 * there is no body; throws a 400 error if it cannot be parsed.
 *
 * The body can only be read once. Call `assertBodySize()` first to limit it.
 */
export function readBody<T = unknown>(event: H3Event): T | null {
    const raw = readRawBody(event);

    if (raw == null) return null;

    const type = event.req.headers["content-type"];

    if (type != null && index(type, "application/x-www-form-urlencoded") == 0) {
        return parseQuery(raw) as T;
    }

    try {
        return json(raw) as T;
    } catch {
        throwHTTPError(400, "Invalid JSON body");
    }
}

/**
 * Stream the request body to `onChunk` in pieces of at most `CHUNK_SIZE`
 * bytes, so memory use stays constant whatever the body size. Use
 * `onDispose()` to clean up after an error.
 *
 * The body can only be read once. Call `assertBodySize()` first to limit it.
 *
 * @example
 * app.post("/state", (event) => {
 *     const file = open("/srv/state.tmp", "w");
 *     // After the rename, unlink() finds nothing to delete.
 *     onDispose(event, () => { file.close(); unlink("/srv/state.tmp"); });
 *     assertBodySize(event, 16 * 1024 * 1024);
 *     readBodyStream(event, (chunk) => { file.write(chunk); });
 *     file.flush();
 *     rename("/srv/state.tmp", "/srv/state");
 * });
 */
export function readBodyStream(event: H3Event, onChunk: (chunk: string) => void): void {
    receive(event as EventState, CHUNK_SIZE, onChunk);
}

/**
 * Register a callback that runs once the response has been sent, or failed.
 * Useful to release resources such as temporary files.
 */
export function onDispose(event: H3Event, callback: () => void): void {
    const state = event as EventState;

    if (state.disposers == null) state.disposers = [callback];
    else push(state.disposers, callback);
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** Build the CGI header block. `contentLength` -1 means unknown. */
function formatHead(
    status: number,
    statusText: string | null,
    headers: Record<string, string> | null,
    contentType: string | null,
    contentLength: number,
): string {
    if (status < 100 || status > 599) die("Invalid response status " + status);

    let head =
        statusText != null
            ? "Status: " + status + " " + statusText + "\r\n"
            : (STATUS_LINES[status] ?? "Status: " + status + " Unknown\r\n");

    if (headers != null) {
        const names = keys(headers);

        for (let i = 0; i < length(names); i++) {
            const name = names[i] as string;

            head += name + ": " + headers[name] + "\r\n";
        }

        if (headers["content-type"] != null) contentType = null;
    }

    if (contentType != null) head += "Content-Type: " + contentType + "\r\n";
    if (contentLength >= 0 && status != 204 && status != 304)
        head += "Content-Length: " + contentLength + "\r\n";

    return head + "\r\n";
}

/** Whether the response must not have a body. */
function bodyless(event: H3Event, status: number): boolean {
    return event.req.method == "HEAD" || status == 204 || status == 304;
}

/** Write a complete response with a single write. */
function sendBody(
    event: EventState,
    status: number,
    statusText: string | null,
    headers: Record<string, string> | null,
    contentType: string | null,
    body: string | null,
): void {
    const head = formatHead(
        status,
        statusText,
        headers,
        body != null ? contentType : null,
        body != null ? length(body) : 0,
    );

    event.sent = true;
    uhttpd.send(head, body != null && !bodyless(event, status) ? body : null);
}

/**
 * Stream a whole file in `CHUNK_SIZE` pieces, then close it. The length is
 * taken from the file, so replace files by renaming a new one over them:
 * rewriting one in place while it is sent cannot be answered correctly.
 */
function sendFile(event: EventState, file: FileHandle): void {
    const res = event.res;

    file.seek(0, 2);

    const size = file.tell();

    if (size == null) {
        file.close();
        die("Cannot determine the size of the file");
    }

    file.seek(0, 0);

    const head = formatHead(
        res.status,
        res.statusText,
        res.headers,
        "application/octet-stream",
        size,
    );

    event.sent = true;
    uhttpd.send(head);

    let remaining = bodyless(event, res.status) ? 0 : size;

    while (remaining > 0) {
        const chunk = file.read(remaining < CHUNK_SIZE ? remaining : CHUNK_SIZE);

        if (chunk == null || chunk == "") break;

        uhttpd.send(chunk);
        remaining -= length(chunk);
    }

    file.close();

    if (remaining > 0) die("The file was truncated while being sent");
}

/** Convert the handler's return value into the response. */
function sendValue(event: EventState, value: unknown): void {
    const res = event.res;
    const kind = type(value);

    if (kind == null) {
        sendBody(event, res.status, res.statusText, res.headers, null, null);
    } else if (kind == "string") {
        sendBody(
            event,
            res.status,
            res.statusText,
            res.headers,
            "text/plain;charset=UTF-8",
            value as string,
        );
    } else if (kind == "resource") {
        sendFile(event, value as FileHandle);
    } else if (kind == "function") {
        die("Handlers cannot return functions");
    } else {
        sendBody(
            event,
            res.status,
            res.statusText,
            res.headers,
            "application/json;charset=UTF-8",
            sprintf("%J", value),
        );
    }
}

function sendError(event: EventState, error: HTTPError, options: H3Options): void {
    if (error.unhandled && options.silent != true) {
        warn("[h3] Unhandled ", error.cause?.type, ": ", error.message, "\n");
    }

    if (options.onError != null) {
        try {
            options.onError(error, event);
        } catch (err) {
            warn("[h3] onError failed: ", (err as UcodeException).message, "\n");
        }
    }

    const reason = REASONS[error.status] ?? "Error";
    const expose = !error.unhandled || options.debug == true;
    const body: Record<string, unknown> = {
        status: error.status,
        statusText: error.statusText ?? reason,
        message: expose ? error.message : reason,
    };

    if (error.data != null) body["data"] = error.data;
    if (error.unhandled && options.debug == true) body["stack"] = error.cause?.stacktrace;

    sendBody(
        event,
        error.status,
        error.statusText,
        error.headers,
        "application/json;charset=UTF-8",
        sprintf("%J", body),
    );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function callMiddleware(
    middleware: Middleware[],
    i: number,
    event: H3Event,
    handler: EventHandler,
): unknown {
    if (i == length(middleware)) return handler(event);

    let called = false;
    let result: unknown = null;

    const next = function (): unknown {
        if (!called) {
            called = true;
            result = callMiddleware(middleware, i + 1, event, handler);
        }

        return result;
    };

    const value = (middleware[i] as Middleware)(event, next);

    return value != null ? value : next();
}

function createEvent(env: UhttpdRequestEnv): EventState {
    const qs = env.QUERY_STRING;

    return {
        req: { method: env.REQUEST_METHOD, url: env.REQUEST_URI, headers: env.headers },
        url: { pathname: env.PATH_INFO ?? "/", search: qs != null && qs != "" ? "?" + qs : "" },
        res: { status: 200, statusText: null, headers: {} },
        context: { params: {} },
        env,
        sent: false,
        bodyRead: false,
        bodyLimit: -1,
        disposers: null,
    };
}

function dispose(event: EventState): void {
    const disposers = event.disposers;

    if (disposers == null) return;

    for (let i = 0; i < length(disposers); i++) {
        try {
            (disposers[i] as () => void)();
        } catch (err) {
            warn("[h3] onDispose callback failed: ", (err as UcodeException).message, "\n");
        }
    }
}

function handle(
    root: RouteNode,
    middleware: Middleware[],
    options: H3Options,
    env: UhttpdRequestEnv,
): void {
    const event = createEvent(env);

    try {
        if (options.onRequest != null) options.onRequest(event);

        const segments = segmentsOf(event.url.pathname);
        const state: { allowed: RouteNode | null } = { allowed: null };
        const route = findRoute(root, segments, 0, event.req.method, state);
        let handler: EventHandler;

        if (route != null) {
            event.context.params = routeParams(route, segments);
            handler = route.handler;
        } else if (state.allowed != null) {
            const allow = allowHeader(state.allowed);

            handler = function (): never {
                throwHTTPError(405, null, { headers: { allow } });
            };
        } else {
            handler = function (): never {
                throwHTTPError(
                    404,
                    "Cannot find any route matching [" +
                        event.req.method +
                        "] " +
                        event.url.pathname,
                );
            };
        }

        const value =
            length(middleware) == 0
                ? handler(event)
                : callMiddleware(middleware, 0, event, handler);

        sendValue(event, value);
    } catch (err) {
        const error = toHTTPError(err as UcodeException);

        // Once the headers are out, the response cannot be replaced anymore.
        if (event.sent) warn("[h3] Error after the response started: ", error.message, "\n");
        else sendError(event, error, options);
    }

    dispose(event);
}

/**
 * Create an app. Register routes and middleware at load time: uhttpd loads
 * the script once and forks for every request, so the router is built once.
 *
 * Route patterns (relative to the uhttpd prefix) support `:name` and `*`
 * for one segment, and a final `**` or `**:name` for the rest of the path.
 * The most specific route wins; GET routes also answer HEAD requests (with
 * the body omitted), and a path matching only other methods gets a 405.
 */
export function createApp(options?: H3Options | null): H3 {
    const root = newNode();
    const middleware: Middleware[] = [];
    const config = options ?? {};
    const app = {} as H3;

    const on = function (method: string, route: string, handler: EventHandler): H3 {
        addRoute(root, method, route, handler);
        return app;
    };

    app.on = on;
    app.all = (route, handler) => on("", route, handler);
    app.get = (route, handler) => on("GET", route, handler);
    app.post = (route, handler) => on("POST", route, handler);
    app.put = (route, handler) => on("PUT", route, handler);
    app.patch = (route, handler) => on("PATCH", route, handler);
    app.delete = (route, handler) => on("DELETE", route, handler);
    app.head = (route, handler) => on("HEAD", route, handler);
    app.options = (route, handler) => on("OPTIONS", route, handler);
    app.use = (fn) => {
        push(middleware, fn);
        return app;
    };
    app.handler = (env) => {
        handle(root, middleware, config, env);
    };

    return app;
}

/** Register the app as uhttpd's `handle_request()` callback. */
export function serve(app: H3): void {
    global.handle_request = app.handler;
}
