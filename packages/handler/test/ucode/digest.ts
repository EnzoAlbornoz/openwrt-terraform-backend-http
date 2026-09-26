/**
 * A Node stand-in for ucode's `digest` module. Hashes are lowercase hex, and
 * `*_file()` functions resolve paths in the `fs` sandbox.
 *
 * @see https://ucode-lang.org/module-digest.html
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { hostPath } from "./fs.ts";

function hash(algorithm: string) {
    return (str: string): string =>
        createHash(algorithm).update(Buffer.from(str, "latin1")).digest("hex");
}

function hashFile(algorithm: string) {
    return (path: string): string | null => {
        try {
            return createHash(algorithm)
                .update(readFileSync(hostPath(path)))
                .digest("hex");
        } catch {
            return null;
        }
    };
}

export const md5 = hash("md5");
export const md5_file = hashFile("md5");
export const sha1 = hash("sha1");
export const sha1_file = hashFile("sha1");
export const sha256 = hash("sha256");
export const sha256_file = hashFile("sha256");
export const sha512 = hash("sha512");
export const sha512_file = hashFile("sha512");
