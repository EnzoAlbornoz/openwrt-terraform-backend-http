/**
 * A Node stand-in for the ucode core builtins, so the handler sources can
 * run unmodified under `node --test`.
 *
 * ucode strings are byte strings, so strings crossing the boundary (files,
 * stdin, responses) are "binary" strings here: one char per byte (latin1).
 * `length()` then counts bytes as in ucode, and `json()` / `%J` convert
 * between those bytes and UTF-8 text.
 *
 * Only what the handler needs is covered, following the semantics described
 * in `@types/ucode`.
 *
 * @see https://ucode-lang.org/module-core.html
 */

/** Marks `fs` resources, so `type()` reports them as `"resource"`. */
export const RESOURCE: unique symbol = Symbol("ucode.resource");

/** Output of `print()` and `warn()`, kept out of the test reporter. */
export const output = { stdout: [] as string[], stderr: [] as string[] };

type Value = unknown;
type Dict = Record<string, Value>;

export function toBinary(text: string): string {
    return Buffer.from(text, "utf8").toString("latin1");
}

export function fromBinary(bytes: string): string {
    return Buffer.from(bytes, "latin1").toString("utf8");
}

function isDict(value: Value): value is Dict {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Convert a value to a string like ucode's string concatenation does. */
export function tostring(value: Value): string {
    if (value == null) return "null";
    if (typeof value === "string") return value;
    if (value instanceof RegExp) return `/${value.source}/${value.flags}`;
    if (typeof value === "object") return JSON.stringify(value);
    if (typeof value === "function") return "function () { ... }";

    return String(value as number | boolean);
}

/** Map the strings of a parsed JSON value (including keys) to byte strings. */
function binaryStrings(value: Value): Value {
    if (typeof value === "string") return toBinary(value);
    if (Array.isArray(value)) return value.map(binaryStrings);
    if (isDict(value)) {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [toBinary(key), binaryStrings(item)]),
        );
    }

    return value;
}

function ucodeType(value: Value): string | null {
    if (value == null) return null;

    switch (typeof value) {
        case "string":
            return "string";
        case "number":
            return Number.isInteger(value) ? "int" : "double";
        case "boolean":
            return "bool";
        case "function":
            return "function";
    }

    if (Array.isArray(value)) return "array";
    if (value instanceof RegExp) return "regexp";
    if (typeof value === "object" && RESOURCE in value) return "resource";

    return "object";
}

/** An exception as caught by ucode's `catch (e)`. */
function exception(message: string): Error {
    return Object.assign(new Error(message), { type: "Runtime error", stacktrace: [] });
}

function die(message: Value): never {
    if (isDict(message) || message instanceof Error) throw message;

    throw exception(tostring(message));
}

function substr(str: string, off: number, len?: number | null): string {
    const size = str.length;
    const start = off < 0 ? Math.max(size + off, 0) : Math.min(off, size);
    const end = len == null ? size : len < 0 ? Math.max(size + len, start) : start + len;

    return str.slice(start, end);
}

function index(haystack: Value, needle: Value): number {
    if (typeof haystack === "string")
        return typeof needle === "string" ? haystack.indexOf(needle) : -1;
    if (Array.isArray(haystack)) return haystack.indexOf(needle);

    return -1;
}

function split(str: string, sep: string | RegExp, limit?: number): string[] {
    if (limit == null || limit <= 0 || typeof sep !== "string" || sep === "") return str.split(sep);

    const parts: string[] = [];
    let rest = str;

    while (parts.length < limit - 1) {
        const at = rest.indexOf(sep);

        if (at < 0) break;

        parts.push(rest.slice(0, at));
        rest = rest.slice(at + sep.length);
    }

    parts.push(rest);

    return parts;
}

function replace(
    str: string,
    pattern: string | RegExp,
    replacement: string | ((...args: string[]) => Value),
    limit?: number,
): string {
    const fn =
        typeof replacement === "function"
            ? (match: string, ...rest: Value[]) => {
                  // JS appends the offset and the input (and named groups).
                  const groups = rest.slice(
                      0,
                      rest.findIndex((item) => typeof item === "number"),
                  );

                  return tostring(replacement(match, ...(groups as string[])));
              }
            : null;

    const replacer = (fn ?? replacement) as string;

    if (typeof pattern !== "string") return str.replace(pattern, replacer);
    if (limit == null) return str.replaceAll(pattern, replacer);

    // String patterns replace every occurrence, up to `limit` of them.
    let result = str;

    for (let i = 0; i < limit && result.includes(pattern); i++)
        result = result.replace(pattern, replacer);

    return result;
}

function match(str: string, pattern: RegExp): Value {
    const groups = (m: RegExpMatchArray) => Array.from(m, (item) => item ?? null);

    if (pattern.global) {
        const all = [...str.matchAll(pattern)].map(groups);

        return all.length > 0 ? all : null;
    }

    const m = str.match(pattern);

    return m != null ? groups(m) : null;
}

function int(value: Value, base?: number): number {
    if (typeof value === "number") return Math.trunc(value);
    if (typeof value === "boolean") return value ? 1 : 0;
    if (value == null) return 0;
    if (typeof value === "string") return Number.parseInt(value.trim(), base ?? 10);

    return Number.NaN;
}

function trimmer(mode: "both" | "start" | "end") {
    return (str: string, chars = " \t\r\n"): string => {
        let start = 0;
        let end = str.length;

        if (mode !== "end") while (start < end && chars.includes(str[start] as string)) start++;
        if (mode !== "start") while (end > start && chars.includes(str[end - 1] as string)) end--;

        return str.slice(start, end);
    };
}

function json(source: Value): Value {
    let text: string;

    if (typeof source === "string") {
        text = source;
    } else if (isDict(source) && typeof source["read"] === "function") {
        const read = source["read"] as (size: number) => string | null;
        let chunk: string | null;

        text = "";

        while ((chunk = read.call(source, 4096)) != null && chunk !== "") text += chunk;
    } else {
        throw exception("Passed value is neither a string nor an object");
    }

    try {
        return binaryStrings(JSON.parse(fromBinary(text)));
    } catch (err) {
        throw exception((err as Error).message);
    }
}

function pad(text: string, flags: string, width: number): string {
    if (text.length >= width) return text;
    if (flags.includes("-")) return text.padEnd(width);
    if (flags.includes("0")) {
        const sign = text.startsWith("-") ? "-" : "";

        return sign + text.slice(sign.length).padStart(width - sign.length, "0");
    }

    return text.padStart(width);
}

function sprintf(format: string, ...args: Value[]): string {
    let next = 0;

    return format.replace(
        /%(\d+\$)?([-+ 0#]*)(\d+)?(?:\.(\d*))?([diouxXeEfFgGcsJ%])/g,
        (
            _all,
            position: string | undefined,
            flags: string,
            width: string | undefined,
            precision: string | undefined,
            conv: string,
        ) => {
            if (conv === "%") return "%";

            const arg = position != null ? args[Number.parseInt(position) - 1] : args[next++];
            const w = width != null ? Number.parseInt(width) : 0;
            let text: string;

            switch (conv) {
                case "d":
                case "i":
                case "u":
                    text = String(int(arg));
                    break;
                case "o":
                    text = int(arg).toString(8);
                    break;
                case "x":
                    text = int(arg).toString(16);
                    break;
                case "X":
                    text = int(arg).toString(16).toUpperCase();
                    break;
                case "c":
                    text = String.fromCharCode(int(arg) & 255);
                    break;
                case "s":
                    text = tostring(arg);
                    break;
                case "J":
                    // `%.J` pretty prints with tabs, `%.<n>J` with n spaces.
                    text =
                        JSON.stringify(
                            arg ?? null,
                            null,
                            precision == null
                                ? undefined
                                : precision === ""
                                  ? "\t"
                                  : Number.parseInt(precision),
                        ) ?? "null";
                    break;
                default: {
                    const n = typeof arg === "number" ? arg : Number(arg);
                    const digits = precision != null ? Number.parseInt(precision || "0") : 6;

                    text =
                        conv === "e" || conv === "E"
                            ? n.toExponential(digits)
                            : conv === "g" || conv === "G"
                              ? String(Number(n.toPrecision(digits || 1)))
                              : n.toFixed(digits);

                    if (conv === "E" || conv === "G") text = text.toUpperCase();
                }
            }

            return pad(text, flags, w);
        },
    );
}

function b64dec(str: string): string | null {
    if (str.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return null;

    return Buffer.from(str, "base64").toString("latin1");
}

function hexdec(str: string, skip = " \t\n"): string | null {
    const digits = str
        .split("")
        .filter((char) => !skip.includes(char))
        .join("");

    if (digits.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(digits)) return null;

    return Buffer.from(digits, "hex").toString("latin1");
}

function clock(monotonic?: boolean): [number, number] {
    if (monotonic === true) {
        const ns = process.hrtime.bigint();

        return [Number(ns / 1_000_000_000n), Number(ns % 1_000_000_000n)];
    }

    const ms = Date.now();

    return [
        Math.floor(ms / 1000),
        (ms % 1000) * 1_000_000 + Number(process.hrtime.bigint() % 1_000_000n),
    ];
}

/** The ucode builtins, installed as globals by `installRuntime()`. */
const builtins = {
    b64dec,
    b64enc: (str: string) => Buffer.from(str, "latin1").toString("base64"),
    chr: (...bytes: number[]) =>
        String.fromCharCode(...bytes.map((b) => Math.min(Math.max(int(b), 0), 255))),
    clock,
    die,
    exists: (obj: Dict, key: string) => Object.hasOwn(obj, key),
    filter: <T>(arr: T[], fn: (value: T, i: number, arr: T[]) => Value) =>
        arr.filter((v, i) => fn(v, i, arr)),
    hexdec,
    hexenc: (str: string) => Buffer.from(str, "latin1").toString("hex"),
    index,
    int,
    join: (sep: string, arr: Value[]) => arr.map(tostring).join(sep),
    json,
    keys: (obj: Value) => (isDict(obj) ? Object.keys(obj) : null),
    lc: (str: string) => str.replace(/[A-Z]/g, (c) => c.toLowerCase()),
    length: (value: Value) =>
        typeof value === "string" || Array.isArray(value)
            ? value.length
            : isDict(value)
              ? Object.keys(value).length
              : null,
    ltrim: trimmer("start"),
    map: <T>(arr: T[], fn: (value: T, i: number, arr: T[]) => Value) =>
        arr.map((v, i) => fn(v, i, arr)),
    match,
    ord: (str: string, offset = 0) => {
        const code = str.charCodeAt(offset < 0 ? str.length + offset : offset);

        return Number.isNaN(code) ? null : code;
    },
    pop: <T>(arr: T[]) => arr.pop() ?? null,
    print: (...values: Value[]) => {
        const text = values.map((v) => (v == null ? "" : tostring(v))).join("");

        output.stdout.push(text);
        return text.length;
    },
    push: <T>(arr: T[], ...values: T[]) => {
        arr.push(...values);
        return values.at(-1) ?? null;
    },
    replace,
    rtrim: trimmer("end"),
    shift: <T>(arr: T[]) => arr.shift() ?? null,
    slice: <T>(arr: T[], off?: number, end?: number) => arr.slice(off, end),
    sort: <T>(arr: T[], fn?: (a: T, b: T) => number) => arr.sort(fn),
    split,
    sprintf,
    substr,
    time: () => Math.floor(Date.now() / 1000),
    trim: trimmer("both"),
    type: ucodeType,
    uc: (str: string) => str.replace(/[a-z]/g, (c) => c.toUpperCase()),
    uniq: <T>(arr: T[]) => [...new Set(arr)],
    unshift: <T>(arr: T[], ...values: T[]) => {
        arr.unshift(...values);
        return values.at(-1) ?? null;
    },
    values: (obj: Dict) => Object.values(obj),
    warn: (...values: Value[]) => {
        const text = values.map((v) => (v == null ? "" : tostring(v))).join("");

        output.stderr.push(text);
        return text.length;
    },
};

/** Install the ucode builtins as globals. */
export function installRuntime(): void {
    Object.assign(globalThis, builtins);
}
