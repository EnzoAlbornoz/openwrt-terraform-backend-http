/**
 * Contract tests: the handler must answer the requests of OpenTofu's `http`
 * backend client the way the client expects.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, before, beforeEach, describe, it } from "node:test";

import {
    basicAuth,
    contentMD5,
    createSandbox,
    forceUnlockInfo,
    loadHandler,
    lockInfo,
    PASSWORD,
    request,
    tofuClient,
    USERNAME,
    type Sandbox,
} from "./harness.ts";
import { messages } from "./ucode/log.ts";
import { output } from "./ucode/runtime.ts";
import { setConfig } from "./ucode/uci.ts";

const ADDRESS = "/home/network";

let sandbox: Sandbox;

before(loadHandler);

beforeEach(() => {
    sandbox = createSandbox();
    configure();
    messages.splice(0);
});

afterEach(() => {
    sandbox.remove();

    // Unhandled errors and failed cleanups are only logged.
    const logged = output.stderr.splice(0);

    assert.deepEqual(logged, [], "the handler logged errors");
});

/** A `user` section, with the password hashed as `terraform-backend-user` does. */
function user(password: string, options: Record<string, string | string[]> = {}) {
    const salt = "8d1f0c2a6b7e4e39a0f5d3c1b2a49e76";
    const hash = createHash("sha256")
        .update(salt + password)
        .digest("hex");

    return { ".type": "user", password: `sha256$${salt}$${hash}`, ...options };
}

/** Set the `terraform-backend` sections, next to the default user. */
function configure(sections: Record<string, Record<string, string | string[]>> = {}): void {
    setConfig({ "terraform-backend": { [USERNAME]: user(PASSWORD), ...sections } });
}

function state(serial: number, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        version: 4,
        terraform_version: "1.11.0",
        serial,
        lineage: "3f3e6a42-8d2b-4f3c-9d1c-6b2f0b0e7a11",
        outputs: {},
        resources: [],
        ...extra,
    });
}

function statePath(workspace = "home", name = "network"): string {
    return sandbox.path(`/etc/terraform/${workspace}/${name}.tfstate`);
}

function lockPath(workspace = "home", name = "network"): string {
    return sandbox.path(`/var/run/terraform/${workspace}/${name}.lock`);
}

function storedState(workspace?: string, name?: string): string | null {
    const path = statePath(workspace, name);

    return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function stateFiles(workspace = "home"): string[] {
    return readdirSync(sandbox.path(`/etc/terraform/${workspace}`));
}

describe("state", () => {
    it("reports a missing state as not found", () => {
        // The client reads 404 (and 204) as "no state yet".
        assert.equal(tofuClient(ADDRESS).get().status, 404);
    });

    it("stores a state in /etc/terraform and returns it", () => {
        const client = tofuClient(ADDRESS);
        const data = state(1);

        assert.equal(client.put(data).status, 200);
        assert.equal(storedState(), data);

        const response = client.get();

        assert.equal(response.status, 200);
        assert.equal(response.text, data);
        assert.equal(response.headers["content-type"], "application/json");
        assert.equal(response.headers["content-length"], String(Buffer.byteLength(data)));
    });

    it("replaces a state without leaving temporary files behind", () => {
        const client = tofuClient(ADDRESS);

        client.put(state(1));
        assert.equal(client.put(state(2)).status, 200);

        assert.equal(client.get().text, state(2));
        assert.deepEqual(stateFiles(), ["network.tfstate"]);
    });

    it("accepts PUT as update method", () => {
        const client = tofuClient(ADDRESS, { updateMethod: "PUT" });

        assert.equal(client.put(state(1)).status, 200);
        assert.equal(storedState(), state(1));
    });

    it("answers HEAD requests without a body", () => {
        tofuClient(ADDRESS).put(state(1));

        const response = request({
            method: "HEAD",
            path: ADDRESS,
            headers: { authorization: basicAuth() },
        });

        assert.equal(response.status, 200);
        assert.equal(response.headers["content-length"], String(state(1).length));
        assert.equal(response.body.length, 0);
    });

    it("streams large states byte for byte", () => {
        const client = tofuClient(ADDRESS);
        // Several stream chunks, with multibyte UTF-8 characters.
        const resources = Array.from({ length: 4000 }, (_, i) => ({
            type: "openwrt_network_interface",
            name: `iface_${i}`,
            description: "Configuração de rede — ☃",
        }));
        const data = Buffer.from(state(7, { resources }));

        assert.ok(data.length > 4 * 65536);
        assert.equal(client.put(data).status, 200);
        assert.ok(readFileSync(statePath()).equals(data));
        assert.ok(client.get().body.equals(data));
    });

    it("accepts bodies without Content-Length (chunked encoding)", () => {
        const data = state(1);
        const response = request({
            method: "POST",
            path: ADDRESS,
            headers: { authorization: basicAuth(), "content-md5": contentMD5(data) },
            body: data,
            chunked: true,
        });

        assert.equal(response.status, 200);
        assert.equal(storedState(), data);
    });

    it("rejects a body not matching its Content-MD5, keeping the current state", () => {
        tofuClient(ADDRESS).put(state(1));

        const response = request({
            method: "POST",
            path: ADDRESS,
            headers: { authorization: basicAuth(), "content-md5": contentMD5(state(3)) },
            body: state(2),
        });

        assert.equal(response.status, 400);
        assert.equal(storedState(), state(1));
        assert.deepEqual(stateFiles(), ["network.tfstate"]);
    });

    it("rejects a malformed Content-MD5", () => {
        const response = request({
            method: "POST",
            path: ADDRESS,
            headers: { authorization: basicAuth(), "content-md5": "not base64!" },
            body: state(1),
        });

        assert.equal(response.status, 400);
        assert.equal(storedState(), null);
    });

    it("rejects an empty state", () => {
        const response = request({
            method: "POST",
            path: ADDRESS,
            headers: { authorization: basicAuth() },
        });

        assert.equal(response.status, 400);
        assert.equal(storedState(), null);
    });

    it("rejects states over the size limit without reading them", () => {
        const response = request({
            method: "POST",
            path: ADDRESS,
            headers: { authorization: basicAuth(), "content-length": String(32 * 1024 * 1024) },
            body: state(1),
        });

        assert.equal(response.status, 413);
        assert.equal(storedState(), null);
    });

    it("deletes a state", () => {
        const client = tofuClient(ADDRESS);

        client.put(state(1));

        assert.equal(client.delete().status, 200);
        assert.equal(storedState(), null);
        assert.equal(client.get().status, 404);
        assert.equal(client.delete().status, 404);
    });

    it("keeps states of different workspaces apart", () => {
        tofuClient("/home/network").put(state(1));
        tofuClient("/office/network").put(state(2));

        assert.equal(tofuClient("/home/network").get().text, state(1));
        assert.equal(tofuClient("/office/network").get().text, state(2));
        assert.equal(storedState("office"), state(2));
    });

    it("treats a state named `lock` as a state", () => {
        const client = tofuClient("/home/lock");

        assert.equal(client.put(state(1)).status, 200);
        assert.equal(storedState("home", "lock"), state(1));
    });
});

describe("locking", () => {
    it("locks a state, storing the lock info in /var/run/terraform", () => {
        const info = lockInfo("0c5d6c1e-1b1f-4b83-a1d4-2f7d4c7f0a01");
        const response = tofuClient(ADDRESS).lock(info);

        assert.equal(response.status, 200);
        assert.deepEqual(response.json(), info);
        assert.equal(readFileSync(lockPath(), "utf8"), JSON.stringify(info));
    });

    it("refuses a second lock, reporting who holds it", () => {
        const holder = lockInfo("holder");

        tofuClient(ADDRESS).lock(holder);

        const response = tofuClient(ADDRESS).lock(lockInfo("other"));

        // The client accepts 409 or 423 and decodes the body as the holder's lock info.
        assert.equal(response.status, 423);
        assert.deepEqual(response.json(), holder);
        assert.equal(readFileSync(lockPath(), "utf8"), JSON.stringify(holder));
    });

    it("accepts locking again with the held lock's ID", () => {
        const info = lockInfo("holder");

        tofuClient(ADDRESS).lock(info);

        assert.equal(tofuClient(ADDRESS).lock(lockInfo("holder", "OperationTypePlan")).status, 200);
        assert.equal(readFileSync(lockPath(), "utf8"), JSON.stringify(info));
    });

    it("requires the lock ID to write a locked state", () => {
        const client = tofuClient(ADDRESS);
        const holder = lockInfo("holder");

        client.put(state(1));
        client.lock(holder);

        const anonymous = client.put(state(2));

        assert.equal(anonymous.status, 423);
        assert.deepEqual(anonymous.json(), holder);
        assert.equal(client.put(state(2), "other").status, 423);
        assert.equal(storedState(), state(1));

        assert.equal(client.put(state(2), "holder").status, 200);
        assert.equal(storedState(), state(2));
    });

    it("rejects writes claiming a lock that is not held", () => {
        // E.g. the lock was force-unlocked while the client was applying.
        const client = tofuClient(ADDRESS);

        client.put(state(1));

        assert.equal(client.put(state(2), "gone").status, 409);
        assert.equal(storedState(), state(1));
    });

    it("requires the lock ID to delete a locked state", () => {
        const client = tofuClient(ADDRESS);

        client.put(state(1));
        client.lock(lockInfo("holder"));

        assert.equal(client.delete().status, 423);
        assert.equal(storedState(), state(1));

        const response = request({
            method: "DELETE",
            path: ADDRESS + "?ID=holder",
            headers: { authorization: basicAuth() },
        });

        assert.equal(response.status, 200);
        assert.equal(storedState(), null);
    });

    it("unlocks with the holder's lock info", () => {
        const client = tofuClient(ADDRESS);
        const info = lockInfo("holder");

        client.lock(info);

        assert.equal(client.unlock(info).status, 200);
        assert.equal(existsSync(lockPath()), false);
        assert.equal(client.lock(lockInfo("next")).status, 200);
    });

    it("refuses to unlock a lock held by someone else", () => {
        const client = tofuClient(ADDRESS);
        const holder = lockInfo("holder");

        client.lock(holder);

        const response = client.unlock(lockInfo("other"));

        assert.equal(response.status, 423);
        assert.deepEqual(response.json(), holder);
        assert.equal(existsSync(lockPath()), true);
    });

    it("force-unlocks with the lock ID", () => {
        const client = tofuClient(ADDRESS);

        client.lock(lockInfo("stale"));

        assert.equal(client.unlock(forceUnlockInfo("stale")).status, 200);
        assert.equal(existsSync(lockPath()), false);
    });

    it("accepts unlocking a state that is not locked", () => {
        assert.equal(tofuClient(ADDRESS).unlock(lockInfo("holder")).status, 200);
    });

    it("rejects invalid lock info", () => {
        const bodies = ["not json", "[]", "{}", '{"ID":""}', '{"ID":42}', ""];

        for (const body of bodies) {
            const response = request({
                method: "POST",
                path: ADDRESS + "/lock",
                headers: { authorization: basicAuth(), "content-type": "application/json" },
                body,
            });

            assert.equal(response.status, 400, `lock info ${JSON.stringify(body)}`);
        }

        assert.equal(existsSync(lockPath()), false);
    });

    it("locks each state separately", () => {
        tofuClient("/home/network").lock(lockInfo("holder"));

        assert.equal(tofuClient("/home/firewall").put(state(1)).status, 200);
        assert.equal(tofuClient("/office/network").lock(lockInfo("other")).status, 200);
    });

    it("runs a full apply like OpenTofu", () => {
        const client = tofuClient(ADDRESS);
        const info = lockInfo("apply");

        assert.equal(client.lock(info).status, 200);
        assert.equal(client.get().status, 404);
        assert.equal(client.put(state(1), info.ID).status, 200);
        assert.equal(client.put(state(2), info.ID).status, 200);
        assert.equal(client.unlock(info).status, 200);

        assert.equal(client.get().text, state(2));
        assert.equal(existsSync(lockPath()), false);
    });
});

describe("config", () => {
    it("stores states and locks in the configured directories", () => {
        configure({
            storage: { ".type": "storage", state_dir: "/mnt/usb/tf/", lock_dir: "/tmp/tf-locks" },
        });

        const client = tofuClient(ADDRESS);

        assert.equal(client.lock(lockInfo("holder")).status, 200);
        assert.equal(client.put(state(1), "holder").status, 200);

        assert.equal(
            readFileSync(sandbox.path("/mnt/usb/tf/home/network.tfstate"), "utf8"),
            state(1),
        );
        assert.equal(existsSync(sandbox.path("/tmp/tf-locks/home/network.lock")), true);
        assert.equal(existsSync(sandbox.path("/etc/terraform")), false);
        assert.equal(existsSync(lockPath()), false);
    });

    it("rejects states larger than the configured size", () => {
        configure({ storage: { max_state_size: "1K" } });

        const client = tofuClient(ADDRESS);

        assert.equal(client.put(state(1, { padding: "x".repeat(1024) })).status, 413);
        assert.equal(client.put(state(1)).status, 200);
    });

    it("fails requests on invalid settings", () => {
        const invalid = [
            { state_dir: "relative/path" },
            { lock_dir: "/" },
            { state_dir: ["/a", "/b"] },
            { max_state_size: "16 MiB" },
            { max_state_size: "0" },
        ];

        for (const storage of invalid) {
            configure({ storage });

            assert.equal(tofuClient(ADDRESS).put(state(1)).status, 500, JSON.stringify(storage));
            assert.match(output.stderr.splice(0).join(""), /Invalid terraform-backend\.storage\./);
        }

        assert.equal(storedState(), null);
    });
});

describe("requests", () => {
    it("reject unsafe workspace and state names", () => {
        const paths = [
            "/%2e%2e/network",
            "/home/%2e%2e",
            "/home/..%2fpasswd",
            "/.hidden/network",
            "/home/.network",
            "/home/a%20b",
            "/home/" + "x".repeat(129),
        ];

        for (const path of paths) {
            assert.equal(tofuClient(path).put(state(1)).status, 400, path);
            assert.equal(tofuClient(path).lock(lockInfo("holder")).status, 400, path);
        }

        assert.equal(existsSync(sandbox.path("/etc/terraform")), false);
    });

    it("reject unsupported methods with the allowed ones", () => {
        const response = request({
            method: "PATCH",
            path: ADDRESS,
            headers: { authorization: basicAuth() },
        });

        assert.equal(response.status, 405);
        assert.deepEqual(response.headers["allow"]?.split(", ").sort(), [
            "DELETE",
            "GET",
            "HEAD",
            "POST",
            "PUT",
        ]);
    });
});

describe("authentication", () => {
    it("requires credentials", () => {
        const client = tofuClient(ADDRESS, { auth: false });
        const response = client.put(state(1));

        assert.equal(response.status, 401);
        assert.equal(
            response.headers["www-authenticate"],
            'Basic realm="terraform-backend", charset="UTF-8"',
        );
        assert.equal(client.get().status, 401);
        assert.equal(client.lock(lockInfo("holder")).status, 401);
        assert.equal(storedState(), null);
        assert.equal(existsSync(lockPath()), false);
    });

    it("answers unknown routes and methods only after authentication", () => {
        // Otherwise the responses would tell what the server is.
        const paths = ["/", "/home", "/home/network/lock/extra"];

        for (const path of paths) assert.equal(request({ method: "GET", path }).status, 401, path);

        assert.equal(request({ method: "PATCH", path: ADDRESS }).status, 401);
    });

    it("rejects wrong passwords and unknown users, logging the attempts", () => {
        const attempts = [
            { username: USERNAME, password: "wrong" },
            { username: USERNAME, password: "" },
            { username: USERNAME, password: PASSWORD + "x" },
            { username: "nobody", password: PASSWORD },
            { username: "TOFU", password: PASSWORD },
        ];

        for (const attempt of attempts) {
            const response = tofuClient(ADDRESS, attempt).put(state(1));

            assert.equal(response.status, 401, JSON.stringify(attempt));
        }

        assert.equal(storedState(), null);
        assert.equal(messages.length, attempts.length);
        assert.deepEqual(messages[3], {
            ident: "terraform-backend",
            facility: 10 << 3,
            priority: 5,
            message: 'Authentication failed for user "nobody" (from 192.168.1.100)',
        });
    });

    it("rejects malformed Authorization headers", () => {
        const headers = [
            "Bearer " + Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64"),
            "Basic",
            "Basic not-base64!",
            // No colon between user name and password.
            "Basic " + Buffer.from(USERNAME + PASSWORD).toString("base64"),
        ];

        for (const authorization of headers) {
            const response = request({ method: "GET", path: ADDRESS, headers: { authorization } });

            assert.equal(response.status, 401, authorization);
        }
    });

    it("accepts any case for the Basic scheme", () => {
        tofuClient(ADDRESS).put(state(1));

        const authorization = basicAuth().replace("Basic", "bAsIc");

        assert.equal(
            request({ method: "GET", path: ADDRESS, headers: { authorization } }).status,
            200,
        );
    });

    it("accepts passwords containing colons", () => {
        configure({ ci: user("a:b:c") });

        const client = tofuClient(ADDRESS, { username: "ci", password: "a:b:c" });

        assert.equal(client.put(state(1)).status, 200);
        assert.equal(tofuClient(ADDRESS, { username: "ci", password: "a" }).get().status, 401);
    });

    it("only accepts sections of type user", () => {
        // Neither other sections nor UCI's extended syntax name a user.
        setConfig({
            "terraform-backend": {
                storage: { ".type": "storage", password: user(PASSWORD).password },
                cfg0123ab: user(PASSWORD),
            },
        });

        for (const username of ["storage", "@user[0]", "@user[-1]"]) {
            const response = tofuClient(ADDRESS, { username }).put(state(1));

            assert.equal(response.status, 401, username);
        }

        assert.equal(storedState(), null);
    });

    it("rejects every request without users", () => {
        setConfig({});

        assert.equal(tofuClient(ADDRESS).put(state(1)).status, 401);
        assert.equal(storedState(), null);
    });

    it("limits users to their workspaces", () => {
        configure({
            ci: user("ci-token", { workspace: ["home", "lab"] }),
            office: user("office-token", { workspace: "office" }),
        });

        const ci = { username: "ci", password: "ci-token" };
        const office = { username: "office", password: "office-token" };

        assert.equal(tofuClient("/home/network", ci).put(state(1)).status, 200);
        assert.equal(tofuClient("/lab/network", ci).lock(lockInfo("holder")).status, 200);
        assert.equal(tofuClient("/office/network", office).put(state(2)).status, 200);

        const denied = tofuClient("/office/network", ci);

        assert.equal(denied.get().status, 403);
        assert.equal(denied.put(state(3)).status, 403);
        assert.equal(denied.lock(lockInfo("holder")).status, 403);
        assert.equal(tofuClient("/home/network", office).get().status, 403);
        assert.equal(storedState("office"), state(2));
        assert.equal(
            messages.at(-1)?.message,
            'User "office" denied access to workspace "home" (from 192.168.1.100)',
        );

        // Users without workspaces may access all of them.
        assert.equal(tofuClient("/office/network").get().text, state(2));
    });

    it("compares workspaces after decoding them", () => {
        configure({ ci: user("ci-token", { workspace: "home" }) });

        const client = tofuClient("/%68ome/network", { username: "ci", password: "ci-token" });

        assert.equal(client.put(state(1)).status, 200);
        assert.equal(storedState(), state(1));
    });

    it("requires HTTPS unless allow_http is set", () => {
        const client = tofuClient(ADDRESS, { https: false });
        const response = client.put(state(1));

        assert.equal(response.status, 403);
        assert.match(response.text, /HTTPS required/);
        assert.equal(storedState(), null);

        configure({ auth: { ".type": "auth", allow_http: "1" } });

        assert.equal(client.put(state(1)).status, 200);
        assert.equal(tofuClient(ADDRESS, { https: false, auth: false }).get().status, 401);
    });

    it("lets every request through when disabled, still over HTTPS", () => {
        setConfig({ "terraform-backend": { auth: { ".type": "auth", enabled: "0" } } });

        assert.equal(tofuClient(ADDRESS, { auth: false }).put(state(1)).status, 200);
        // Credentials are ignored, even wrong ones.
        assert.equal(tofuClient(ADDRESS, { password: "wrong" }).get().text, state(1));
        assert.equal(
            tofuClient("/office/network", { auth: false }).lock(lockInfo("a")).status,
            200,
        );
        assert.equal(tofuClient(ADDRESS, { auth: false, https: false }).get().status, 403);
        assert.deepEqual(messages, []);
    });

    it("fails requests on invalid authentication settings", () => {
        const invalid = [
            { password: "secret" },
            { password: "sha256$salt$" + "0".repeat(63) },
            { password: "sha256$salt$" + "A".repeat(64) },
            { password: "sha256$$" + "0".repeat(64) },
            { password: "sha512$salt$" + "0".repeat(64) },
            { password: ["a", "b"] },
            { ...user(PASSWORD), workspace: "../etc" },
            { ...user(PASSWORD), workspace: ["home", ".hidden"] },
        ];

        for (const options of invalid) {
            configure({ [USERNAME]: { ".type": "user", ...options } });

            assert.equal(tofuClient(ADDRESS).put(state(1)).status, 500, JSON.stringify(options));
            assert.match(output.stderr.splice(0).join(""), /Invalid terraform-backend\.tofu\./);
        }

        for (const name of ["enabled", "allow_http"]) {
            configure({ auth: { [name]: "maybe" } });

            assert.equal(tofuClient(ADDRESS).get().status, 500, name);
            assert.match(
                output.stderr.splice(0).join(""),
                new RegExp(`Invalid terraform-backend\\.auth\\.${name}`),
            );
        }

        assert.equal(storedState(), null);
    });
});
