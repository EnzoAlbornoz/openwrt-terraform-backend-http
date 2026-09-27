/**
 * HTTP basic authentication, with the users configured in UCI (see
 * `config.ts`). The client sends the backend's `username` and `password`
 * with every request.
 *
 * uhttpd's own basic authentication (`/etc/httpd.conf`) does not apply to
 * ucode handlers, so the handler checks the `Authorization` header itself.
 * Passwords are random tokens (see `terraform-backend-user`) rather than
 * chosen ones, so a salted SHA-256 is enough to store them: there is no
 * dictionary to try, and a slow hash would be recomputed on every request.
 */

import { sha256 } from "digest";
import { LOG_AUTHPRIV, LOG_NOTICE, openlog, syslog } from "log";

import { loadUser, type Config } from "./config.js";
import { getRouterParam, throwHTTPError, type H3Event } from "./http.js";

const REALM = "terraform-backend";

interface Credentials {
    name: string;
    password: string;
}

/** Log to syslog's authpriv facility, e.g. for fail2ban-style tooling. */
function logAuth(event: H3Event, message: string): void {
    // Opened on use: at load time, it would change uhttpd's own ident.
    openlog(REALM, 0, LOG_AUTHPRIV);
    syslog(LOG_NOTICE, "%s (from %s)", message, event.env.REMOTE_ADDR);
}

/** The credentials of a `Basic` `Authorization` header, or `null`. */
function basicCredentials(event: H3Event): Credentials | null {
    const header = event.req.headers["authorization"];

    if (header == null) return null;

    const parts = match(header, /^basic +([^ ]+) *$/i);
    const decoded = parts != null ? b64dec(parts[1] as string) : null;
    const colon = decoded != null ? index(decoded, ":") : -1;

    if (decoded == null || colon < 0) return null;

    return { name: substr(decoded, 0, colon), password: substr(decoded, colon + 1) };
}

/** Compare two strings in a time that does not depend on where they differ. */
function equalSecrets(a: string, b: string): boolean {
    if (length(a) != length(b)) return false;

    let diff = 0;

    for (let i = 0; i < length(a); i++) diff |= (ord(a, i) as number) ^ (ord(b, i) as number);

    return diff == 0;
}

function unauthorized(message: string): never {
    throwHTTPError(401, message, {
        headers: { "www-authenticate": 'Basic realm="' + REALM + '", charset="UTF-8"' },
    });
}

/**
 * Let the request through only over HTTPS (unless `allow_http` is set), with
 * the credentials of a user who may access the requested workspace (unless
 * authentication is disabled). Throws a 401 or 403 error otherwise. Stores
 * the user name as `event.context.user`.
 */
export function authenticate(event: H3Event, config: Config): void {
    if (event.env.HTTPS != "on" && !config.allowHttp)
        throwHTTPError(403, "HTTPS required; set terraform-backend.auth.allow_http to allow HTTP");

    // Any credentials sent are ignored, not checked.
    if (!config.authEnabled) return;

    const credentials = basicCredentials(event);

    if (credentials == null) unauthorized("Authentication required");

    const user = loadUser(credentials.name);

    if (user == null || !equalSecrets(sha256(user.salt + credentials.password), user.hash)) {
        logAuth(event, sprintf("Authentication failed for user %J", credentials.name));
        unauthorized("Invalid username or password");
    }

    const workspace = getRouterParam(event, "workspace", { decode: true });

    if (workspace != null && user.workspaces != null && index(user.workspaces, workspace) < 0) {
        logAuth(event, sprintf("User %J denied access to workspace %J", user.name, workspace));
        throwHTTPError(403, "No access to workspace " + workspace);
    }

    event.context["user"] = user.name;
}
