/**
 * Terraform/OpenTofu HTTP state backend.
 *
 * Implements the contract of OpenTofu's `http` backend client. Routes are
 * relative to the uhttpd prefix:
 *
 * | Route                              | Client call                              |
 * | ---------------------------------- | ---------------------------------------- |
 * | `GET /<workspace>/<state>`         | Get: 200 with the state, 404 if none     |
 * | `POST /<workspace>/<state>`        | Put (also `PUT`), `?ID=<lock id>`        |
 * | `DELETE /<workspace>/<state>`      | Delete                                   |
 * | `POST /<workspace>/<state>/lock`   | Lock: 200, or 423 with the holder's info |
 * | `DELETE /<workspace>/<state>/lock` | Unlock: 200                              |
 *
 * uhttpd rejects the client's default `LOCK` and `UNLOCK` methods, so the
 * backend must be configured with:
 *
 * ```hcl
 * backend "http" {
 *   address        = "https://router/tfstate/<workspace>/<state>"
 *   lock_address   = "https://router/tfstate/<workspace>/<state>/lock"
 *   unlock_address = "https://router/tfstate/<workspace>/<state>/lock"
 *   lock_method    = "POST"
 *   unlock_method  = "DELETE"
 * }
 * ```
 *
 * While a state is locked, writing or deleting it requires the lock ID in
 * the `ID` query parameter (the client sends it with every write).
 *
 * @see https://github.com/opentofu/opentofu/blob/main/internal/backend/remote-state/http/client.go
 */

import { md5_file } from "digest";
import { unlink } from "fs";

import {
    assertBodySize,
    createApp,
    getQuery,
    getRouterParam,
    onDispose,
    readBodyStream,
    readRawBody,
    serve,
    throwHTTPError,
    type H3Event,
} from "./http.js";
import {
    commitState,
    createStateUpload,
    isValidName,
    lockId,
    openState,
    readLock,
    removeLock,
    removeState,
    withStateMutex,
    writeLock,
    type Lock,
    type StateRef,
} from "./store.js";

/** Largest accepted state. */
const MAX_STATE_SIZE = 16 * 1024 * 1024;

/** Largest accepted lock info. */
const MAX_LOCK_SIZE = 64 * 1024;

/** The state addressed by the route params; throws a 400 error on invalid names. */
function stateRef(event: H3Event): StateRef {
    const workspace = getRouterParam(event, "workspace", { decode: true }) ?? "";
    const name = getRouterParam(event, "state", { decode: true }) ?? "";

    if (!isValidName(workspace) || !isValidName(name))
        throwHTTPError(400, "Invalid workspace or state name");

    return { workspace, name };
}

/** The lock ID the client claims to hold, from the `ID` query parameter. */
function requestLockId(event: H3Event): string | null {
    const id = getQuery(event)["ID"];

    return id != null && id != "" ? id : null;
}

/**
 * Respond that the state is locked by someone else, with the holder's lock
 * info as body: the client reports its `ID` (and who holds it) to the user.
 */
function locked(event: H3Event, lock: Lock): string {
    event.res.status = 423;
    event.res.headers["content-type"] = "application/json";

    return lock.raw;
}

/**
 * The lock preventing a client holding `id` (or no lock, if `null`) from
 * changing the state, or `null` if it may. Throws a 409 error when the
 * client claims a lock that is not held anymore (e.g. it was force-unlocked),
 * since the state may have changed since it was read. Call with the state's
 * mutex held.
 */
function lockConflict(ref: StateRef, id: string | null): Lock | null {
    const lock = readLock(ref);

    if (lock == null) {
        if (id != null) throwHTTPError(409, "The state is not locked by " + id);

        return null;
    }

    return lock.id != id ? lock : null;
}

/** Read the lock info sent with lock and unlock requests. */
function readLockInfo(event: H3Event): Lock {
    assertBodySize(event, MAX_LOCK_SIZE);

    const raw = readRawBody(event) ?? "";
    let id: string | null = null;

    try {
        id = lockId(json(raw));
    } catch {
        id = null;
    }

    if (id == null) throwHTTPError(400, "Expected lock info: a JSON object with an ID");

    return { id, raw };
}

/**
 * Fail if the upload does not match its `Content-MD5` header (sent by the
 * client with every body), e.g. because it was corrupted in transit.
 */
function verifyContentMD5(event: H3Event, path: string): void {
    const header = event.req.headers["content-md5"];

    if (header == null) return;

    const digest = b64dec(trim(header));

    if (digest == null || length(digest) != 16) throwHTTPError(400, "Malformed Content-MD5 header");
    if (md5_file(path) != hexenc(digest)) throwHTTPError(400, "Content-MD5 mismatch");
}

/** Get: stream the state. */
function getState(event: H3Event): unknown {
    const file = openState(stateRef(event));

    if (file == null) throwHTTPError(404, "State not found");

    event.res.headers["content-type"] = "application/json";

    return file;
}

/**
 * Put: store the body as the new state. It is streamed to a temporary file
 * and verified before replacing the current state, which is left untouched
 * if anything fails.
 */
function putState(event: H3Event): unknown {
    const ref = stateRef(event);
    const id = requestLockId(event);

    assertBodySize(event, MAX_STATE_SIZE);

    const upload = createStateUpload(ref);
    let closed = false;
    let size = 0;

    // After the commit, the upload was renamed and there is nothing to unlink.
    onDispose(event, function (): void {
        if (!closed) upload.file.close();

        unlink(upload.path);
    });

    readBodyStream(event, function (chunk: string): void {
        if (upload.file.write(chunk) != length(chunk)) die("Cannot write " + upload.path);

        size += length(chunk);
    });

    closed = true;

    if (upload.file.close() != true) die("Cannot write " + upload.path);
    if (size == 0) throwHTTPError(400, "Missing state body");

    verifyContentMD5(event, upload.path);

    const conflict = withStateMutex(ref, function (): Lock | null {
        const lock = lockConflict(ref, id);

        if (lock == null) commitState(ref, upload);

        return lock;
    });

    return conflict != null ? locked(event, conflict) : null;
}

/** Delete: remove the state. */
function deleteState(event: H3Event): unknown {
    const ref = stateRef(event);
    const id = requestLockId(event);

    const conflict = withStateMutex(ref, function (): Lock | null {
        const lock = lockConflict(ref, id);

        if (lock == null && !removeState(ref)) throwHTTPError(404, "State not found");

        return lock;
    });

    return conflict != null ? locked(event, conflict) : null;
}

/**
 * Lock: take the lock unless someone else holds it. Locking again with the
 * held lock's ID succeeds. Responds with the held lock info.
 */
function lockState(event: H3Event): unknown {
    const ref = stateRef(event);
    const request = readLockInfo(event);

    const lock = withStateMutex(ref, function (): Lock {
        const held = readLock(ref);

        if (held != null) return held;

        writeLock(ref, request.raw);

        return request;
    });

    if (lock.id != request.id) return locked(event, lock);

    event.res.headers["content-type"] = "application/json";

    return lock.raw;
}

/**
 * Unlock: release the lock if the request carries its ID. The client sends
 * the ID for force-unlocks too, so every unlock is checked. Unlocking a
 * state that is not locked succeeds.
 */
function unlockState(event: H3Event): unknown {
    const ref = stateRef(event);
    const request = readLockInfo(event);

    const conflict = withStateMutex(ref, function (): Lock | null {
        const held = readLock(ref);

        if (held == null) return null;
        if (held.id != request.id) return held;

        removeLock(ref);

        return null;
    });

    return conflict != null ? locked(event, conflict) : null;
}

const app = createApp()
    // Authentication Middleware
    .use((event, next) => {
        // TODO: Implement authentication logic here
        // TODO: Not intended to do now
        const authorization = event.req.headers["authorization"];
        if (!authorization) throwHTTPError(401);

        return next();
    })
    .post("/:workspace/:state/lock", lockState)
    .delete("/:workspace/:state/lock", unlockState)
    .get("/:workspace/:state", getState)
    // The client's `update_method` defaults to POST.
    .post("/:workspace/:state", putState)
    .put("/:workspace/:state", putState)
    .delete("/:workspace/:state", deleteState);

serve(app);
