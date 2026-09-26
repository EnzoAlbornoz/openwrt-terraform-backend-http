/**
 * Contract tests: the handler must answer the requests of OpenTofu's `http`
 * backend client the way the client expects.
 */

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { afterEach, before, beforeEach, describe, it } from "node:test";

import {
    contentMD5,
    createSandbox,
    forceUnlockInfo,
    loadHandler,
    lockInfo,
    request,
    tofuClient,
    type Sandbox,
} from "./harness.ts";
import { output } from "./ucode/runtime.ts";

const ADDRESS = "/home/network";

let sandbox: Sandbox;

before(loadHandler);

beforeEach(() => {
    sandbox = createSandbox();
});

afterEach(() => {
    sandbox.remove();

    // Unhandled errors and failed cleanups are only logged.
    const logged = output.stderr.splice(0);

    assert.deepEqual(logged, [], "the handler logged errors");
});

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
            headers: { authorization: "Bearer token" },
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
            headers: { authorization: "Bearer token", "content-md5": contentMD5(data) },
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
            headers: { authorization: "Bearer token", "content-md5": contentMD5(state(3)) },
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
            headers: { authorization: "Bearer token", "content-md5": "not base64!" },
            body: state(1),
        });

        assert.equal(response.status, 400);
        assert.equal(storedState(), null);
    });

    it("rejects an empty state", () => {
        const response = request({
            method: "POST",
            path: ADDRESS,
            headers: { authorization: "Bearer token" },
        });

        assert.equal(response.status, 400);
        assert.equal(storedState(), null);
    });

    it("rejects states over the size limit without reading them", () => {
        const response = request({
            method: "POST",
            path: ADDRESS,
            headers: { authorization: "Bearer token", "content-length": String(32 * 1024 * 1024) },
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
            headers: { authorization: "Bearer token" },
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
                headers: { authorization: "Bearer token", "content-type": "application/json" },
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

describe("requests", () => {
    it("require an Authorization header", () => {
        const client = tofuClient(ADDRESS, { auth: false });

        assert.equal(client.get().status, 401);
        assert.equal(client.put(state(1)).status, 401);
        assert.equal(client.lock(lockInfo("holder")).status, 401);
        assert.equal(storedState(), null);
    });

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
            headers: { authorization: "Bearer token" },
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
