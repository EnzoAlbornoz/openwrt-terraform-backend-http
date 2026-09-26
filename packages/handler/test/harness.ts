/**
 * Drives the handler like uhttpd does: builds the request environment,
 * pipes the body to stdin, calls `handle_request()` and parses the CGI
 * response it writes with `uhttpd.send()`.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setRoot, setStdin, stdin } from "./ucode/fs.ts";
import { tostring } from "./ucode/runtime.ts";

// ---------------------------------------------------------------------------
// uhttpd
// ---------------------------------------------------------------------------

let sent: Buffer[] = [];

function send(...values: unknown[]): number {
    let count = 0;

    for (const value of values) {
        if (value == null) continue;

        const chunk = Buffer.from(tostring(value), "latin1");

        sent.push(chunk);
        count += chunk.length;
    }

    return count;
}

function urldecode(value: unknown): string {
    const str = value == null ? "" : tostring(value);

    if (/%(?![0-9A-Fa-f]{2})/.test(str)) {
        throw Object.assign(new Error("Invalid URL encoding"), {
            type: "Runtime error",
            stacktrace: [],
        });
    }

    return str.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

function urlencode(value: unknown): string {
    const bytes = Buffer.from(value == null ? "" : tostring(value), "latin1");
    let result = "";

    for (const byte of bytes) {
        const char = String.fromCharCode(byte);

        result += /[A-Za-z0-9._~-]/.test(char)
            ? char
            : "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }

    return result;
}

Object.assign(globalThis, {
    uhttpd: {
        send,
        sendc: send,
        recv: (size = 1024) => {
            const chunk = stdin.read(size);

            return chunk == null || chunk === "" ? null : chunk;
        },
        flush: () => null,
        urldecode,
        urlencode,
        docroot: "/www",
    },
});

// ---------------------------------------------------------------------------
// Sandbox and handler
// ---------------------------------------------------------------------------

/** A temporary directory standing in for the router's filesystem root. */
export interface Sandbox {
    root: string;
    /** The host path of an absolute path on the "router". */
    path(path: string): string;
    remove(): void;
}

export function createSandbox(): Sandbox {
    const root = mkdtempSync(join(tmpdir(), "tfstate-"));

    setRoot(root);

    return {
        root,
        path: (path) => join(root, path),
        remove: () => {
            setRoot(null);
            rmSync(root, { recursive: true, force: true });
        },
    };
}

type RequestHandler = (env: Record<string, unknown>) => void;

/**
 * Load the handler, which registers `handle_request()` like uhttpd's load
 * of the script. Modules are cached, so it runs once per test file.
 */
export async function loadHandler(): Promise<void> {
    // A computed specifier, so the test project does not type-check the
    // ucode sources against Node's libraries.
    const entry = new URL("../src/index.ts", import.meta.url).href;

    await import(entry);
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface RequestOptions {
    method: string;
    /** The path after the uhttpd prefix, with an optional query string. */
    path: string;
    headers?: Record<string, string>;
    body?: string | Buffer | null;
    /** Send the body without `Content-Length`, as with chunked encoding. */
    chunked?: boolean;
}

export interface Response {
    status: number;
    statusText: string;
    /** Header names are lowercase. */
    headers: Record<string, string>;
    body: Buffer;
    /** The body as UTF-8 text. */
    text: string;
    /** The body parsed as JSON. */
    json(): unknown;
}

const PREFIX = "/terraform";

function parseResponse(method: string, raw: Buffer): Response {
    const end = raw.indexOf("\r\n\r\n");

    if (end < 0) throw new Error("Response without header terminator: " + raw.toString("latin1"));

    const lines = raw.toString("latin1", 0, end).split("\r\n");
    const status = /^Status: (\d{3}) (.+)$/.exec(lines[0] ?? "");

    if (status == null) throw new Error("Response without a valid Status line: " + lines[0]);

    const headers: Record<string, string> = {};

    for (const line of lines.slice(1)) {
        const colon = line.indexOf(": ");

        if (colon < 0) throw new Error("Malformed header line: " + line);

        headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 2);
    }

    const body = raw.subarray(end + 4);
    const contentLength = headers["content-length"];

    // Without Content-Length uhttpd would re-encode the response as chunked.
    if (method !== "HEAD" && contentLength != null && Number(contentLength) !== body.length)
        throw new Error(`Content-Length ${contentLength} but ${body.length} body bytes`);

    const text = body.toString("utf8");

    return {
        status: Number(status[1]),
        statusText: status[2] as string,
        headers,
        body,
        text,
        json: () => JSON.parse(text) as unknown,
    };
}

/** Send a request to the handler and return its parsed response. */
export function request(options: RequestOptions): Response {
    const query = options.path.indexOf("?");
    const pathname = query < 0 ? options.path : options.path.slice(0, query);
    const body =
        options.body == null
            ? null
            : typeof options.body === "string"
              ? Buffer.from(options.body, "utf8")
              : options.body;

    const headers: Record<string, string> = { URL: PREFIX + options.path };

    for (const [name, value] of Object.entries(options.headers ?? {}))
        headers[name.toLowerCase()] = value;

    if (body != null && options.chunked === true) headers["transfer-encoding"] = "chunked";
    else if (body != null) headers["content-length"] ??= String(body.length);

    const env: Record<string, unknown> = {
        GATEWAY_INTERFACE: "CGI/1.1",
        SERVER_SOFTWARE: "uhttpd",
        SCRIPT_NAME: PREFIX,
        SCRIPT_FILENAME: "/usr/share/ucode/terraform-backend/handler.uc",
        QUERY_STRING: query < 0 ? "" : options.path.slice(query + 1),
        REQUEST_URI: PREFIX + options.path,
        SERVER_PROTOCOL: "HTTP/1.1",
        REQUEST_METHOD: options.method,
        PATH_INFO: pathname,
        REDIRECT_STATUS: "200",
        SERVER_NAME: "192.168.1.1",
        SERVER_ADDR: "192.168.1.1",
        SERVER_PORT: "443",
        REMOTE_HOST: "192.168.1.100",
        REMOTE_ADDR: "192.168.1.100",
        REMOTE_PORT: "50000",
        HTTP_VERSION: 1.1,
        headers,
    };

    if (headers["content-length"] != null) env["CONTENT_LENGTH"] = headers["content-length"];
    if (headers["content-type"] != null) env["CONTENT_TYPE"] = headers["content-type"];

    setStdin(body ?? Buffer.alloc(0));
    sent = [];

    (globalThis as unknown as { handle_request: RequestHandler }).handle_request(env);

    return parseResponse(options.method, Buffer.concat(sent));
}

// ---------------------------------------------------------------------------
// OpenTofu client
// ---------------------------------------------------------------------------

/** OpenTofu's `statemgr.LockInfo`, as marshalled into lock requests. */
export interface LockInfo {
    ID: string;
    Operation: string;
    Info: string;
    Who: string;
    Version: string;
    Created: string;
    Path: string;
}

export function lockInfo(id: string, operation = "OperationTypeApply"): LockInfo {
    return {
        ID: id,
        Operation: operation,
        Info: "",
        Who: "tofu@workstation",
        Version: "1.11.0",
        Created: new Date().toISOString(),
        Path: "",
    };
}

/**
 * The lock info `tofu force-unlock <id>` sends: a zero `LockInfo` with only
 * the ID set, since that process never took the lock.
 */
export function forceUnlockInfo(id: string): LockInfo {
    return {
        ID: id,
        Operation: "",
        Info: "",
        Who: "",
        Version: "",
        Created: "0001-01-01T00:00:00Z",
        Path: "",
    };
}

export interface ClientOptions {
    /** Defaults to `POST`, like the client's `update_method`. */
    updateMethod?: string;
    /** Send basic auth credentials (default `true`). */
    auth?: boolean;
}

/**
 * Sends the requests OpenTofu's `http` backend client makes, configured with
 * `lock_method = "POST"` and `unlock_method = "DELETE"`.
 *
 * @see https://github.com/opentofu/opentofu/blob/main/internal/backend/remote-state/http/client.go
 */
export function tofuClient(address: string, options: ClientOptions = {}) {
    const lockAddress = address + "/lock";

    function send(method: string, path: string, data: Buffer | null): Response {
        const headers: Record<string, string> = {};

        if (options.auth !== false)
            headers["authorization"] = "Basic " + Buffer.from("tofu:secret").toString("base64");

        // The client only sends a body, with these headers, when it has data.
        if (data != null && data.length > 0) {
            headers["content-type"] = "application/json";
            headers["content-md5"] = contentMD5(data);
        }

        return request({
            method,
            path,
            headers,
            body: data != null && data.length > 0 ? data : null,
        });
    }

    return {
        get: () => send("GET", address, null),
        put: (state: string | Buffer, lockId?: string) =>
            send(
                options.updateMethod ?? "POST",
                lockId != null ? address + "?ID=" + encodeURIComponent(lockId) : address,
                Buffer.from(state),
            ),
        delete: () => send("DELETE", address, null),
        lock: (info: LockInfo) => send("POST", lockAddress, Buffer.from(JSON.stringify(info))),
        unlock: (info: LockInfo) => send("DELETE", lockAddress, Buffer.from(JSON.stringify(info))),
    };
}

/** The base64 MD5 of a body, as sent in `Content-MD5`. */
export function contentMD5(data: string | Buffer): string {
    return createHash("md5").update(data).digest("base64");
}
