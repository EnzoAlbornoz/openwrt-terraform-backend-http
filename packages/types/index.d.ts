/**
 * Type definitions for the ucode language runtime.
 *
 * Meant to be used with `"noLib": true`: this file replaces TypeScript's
 * built-in `lib.*.d.ts`, so only what ucode actually provides is visible.
 * Primitive values have no methods or properties (use `length()`, `substr()`,
 * `index()`, ... instead) and every builtin is a global function.
 *
 * @see https://ucode.mein.io/module-core.html
 */

// ---------------------------------------------------------------------------
// Internal brands
// ---------------------------------------------------------------------------

/**
 * Unique symbols used to make otherwise empty interfaces nominal, so that
 * e.g. plain objects are not assignable to arrays and strings are not
 * assignable to regular expressions. They do not exist at runtime.
 */
declare namespace UcodeInternal {
    const arrayBrand: unique symbol;
    const mutableArrayBrand: unique symbol;
    const regexpBrand: unique symbol;
}

// ---------------------------------------------------------------------------
// Interfaces required by the TypeScript compiler
// ---------------------------------------------------------------------------

/**
 * A ucode array: a true, contiguous in-memory array of arbitrary values.
 *
 * - Arrays have no properties or methods, use the builtins (`length()`,
 *   `push()`, `map()`, ...) instead.
 * - Negative indexes count from the end (`arr[-1]` is the last element).
 * - Writing past the end grows the array, filling the gap with `null`.
 * - Reading an out of range index yields `null`.
 */
interface Array<T> {
    [index: number]: T;
    readonly [UcodeInternal.arrayBrand]: T;
    readonly [UcodeInternal.mutableArrayBrand]: true;
}

/** Read-only view of a ucode array, used for `readonly T[]` types. */
interface ReadonlyArray<T> {
    readonly [index: number]: T;
    readonly [UcodeInternal.arrayBrand]: T;
}

/** ucode booleans have no properties or methods. */
interface Boolean {}

/**
 * ucode numbers are either signed 64 bit integers or IEEE 754 doubles.
 * They have no properties or methods.
 */
interface Number {}

/**
 * ucode strings are byte strings. They have no properties or methods, use
 * `length()`, `substr()`, `index()`, `split()`, ... instead.
 */
interface String {}

/** ucode has no `arguments` object, use rest parameters instead. */
interface IArguments {}

/**
 * ucode functions (closures and native functions) have no properties or
 * methods. Use `call()` to invoke a function with a specific `this`.
 */
interface Function {}

interface CallableFunction extends Function {}

interface NewableFunction extends Function {}

/** ucode objects (dictionaries): ordered hash tables with string keys. */
interface Object {}

/**
 * A compiled ucode regular expression, created by a `/pattern/flags`
 * literal or by `regexp()`.
 *
 * Supported flags: `i` (ignore case), `s` (dot matches newlines) and
 * `g` (global, for `match()`, `replace()` and `split()`).
 */
interface RegExp {
    readonly [UcodeInternal.regexpBrand]: true;
}

// ---------------------------------------------------------------------------
// TypeScript utility types (compile time only)
// ---------------------------------------------------------------------------

/** Marker for the type of `this` within an object literal. */
interface ThisType<T> {}

type PropertyKey = string | number | symbol;

type Partial<T> = { [P in keyof T]?: T[P] };

type Required<T> = { [P in keyof T]-?: T[P] };

type Readonly<T> = { readonly [P in keyof T]: T[P] };

type Pick<T, K extends keyof T> = { [P in K]: T[P] };

type Record<K extends keyof any, T> = { [P in K]: T };

type Exclude<T, U> = T extends U ? never : T;

type Extract<T, U> = T extends U ? T : never;

type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;

type NonNullable<T> = T & {};

type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;

type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;

type ThisParameterType<T> = T extends (this: infer U, ...args: never) => any ? U : unknown;

type OmitThisParameter<T> =
    unknown extends ThisParameterType<T>
        ? T
        : T extends (...args: infer A) => infer R
          ? (...args: A) => R
          : T;

type Uppercase<S extends string> = intrinsic;

type Lowercase<S extends string> = intrinsic;

type Capitalize<S extends string> = intrinsic;

type Uncapitalize<S extends string> = intrinsic;

type NoInfer<T> = intrinsic;

// ---------------------------------------------------------------------------
// ucode types
// ---------------------------------------------------------------------------

/** Type names returned by `type()`. */
type UcodeTypeName =
    | "string"
    | "int"
    | "double"
    | "bool"
    | "array"
    | "object"
    | "function"
    | "regexp"
    | "resource";

/** A single entry of an exception's stack trace. */
interface UcodeStackFrame {
    filename: string;
    line: number;
    byte: number;
    function?: string;
    context?: string;
}

/** The value caught by a `catch (e)` clause. */
interface UcodeException {
    type: string;
    message: string;
    stacktrace: UcodeStackFrame[];
}

/** Anything with a `read()` method, e.g. an `fs.file` resource. */
interface UcodeReadable {
    read(...args: never[]): string | null;
}

/** A compiled program entry function, as returned by `loadstring()`. */
type UcodeProgram = (...args: unknown[]) => unknown;

/**
 * Signal handler accepted by `signal()`: a callback receiving the signal
 * number, `"ignore"` to mask the signal or `"default"` to restore the
 * default behaviour.
 */
type UcodeSignalHandler = ((signo: number) => void) | "ignore" | "default";

/**
 * A parse configuration is a plain object describing options to use when
 * compiling ucode at runtime. All members are optional and default to the
 * state of the running program.
 *
 * @see loadfile
 * @see loadstring
 */
interface ParseConfig {
    /** Whether to strip whitespace preceding template directives. */
    lstrip_blocks?: boolean;
    /** Whether to trim trailing newlines following template directives. */
    trim_blocks?: boolean;
    /** Whether to compile the code in strict mode. */
    strict_declarations?: boolean;
    /** Whether to compile the code in plain script mode (`true`) or template mode (`false`). */
    raw_mode?: boolean;
    /** Override the module search path for compile time imports. */
    module_search_path?: string[];
    /**
     * List of module names assumed to be dynamic library extensions, allows
     * compiling `import` statements referring to `*.so` extensions not
     * present at compile time.
     */
    force_dynlink_list?: string[];
}

/**
 * A plain object describing a point in time. Returned by `gmtime()` and
 * `localtime()`, expected by `timegm()` and `timelocal()`.
 *
 * Unlike C's `struct tm`, `mon`, `wday` and `yday` are 1-based and `year`
 * is the full year.
 */
interface TimeSpec {
    /** Seconds (0..60) */
    sec: number;
    /** Minutes (0..59) */
    min: number;
    /** Hours (0..23) */
    hour: number;
    /** Day of month (1..31) */
    mday: number;
    /** Month (1..12) */
    mon: number;
    /** Year (>= 1900) */
    year: number;
    /** Day of week (1..7, Sunday = 7) */
    wday: number;
    /** Day of year (1..366, Jan 1st = 1) */
    yday: number;
    /** Daylight saving time in effect (yes = 1) */
    isdst: number;
}

/**
 * Metamethods a prototype may define to customize how the interpreter
 * handles its instances. Metamethods are strict fallbacks: they are only
 * consulted when the normal operation cannot complete, and they are only
 * looked up on the prototype chain, never on the value's own keys.
 *
 * Within a metamethod, `this` is the instance, not the prototype. Use
 * `rawget()`, `rawset()` and `rawdelete()` to access the underlying storage
 * without re-dispatching.
 *
 * @see https://ucode.mein.io/tutorial-06-metamethods.html
 */
interface UcodeMetamethods {
    [key: string]: unknown;
    /** Invoked when the value is called but is not a function. */
    __call__?(...args: never[]): unknown;
    /**
     * Invoked when reading a key not found on the value nor its prototype
     * chain. Returning `null` means "still missing"; returning an object or
     * array delegates the lookup to it.
     */
    __get__?(key: string | number): unknown;
    /**
     * Invoked when writing a key that is not an own key of the value. The
     * return value is ignored, throw to reject the assignment.
     */
    __set__?(key: string | number, value: never): unknown;
    /**
     * Invoked when deleting a key that is not an own key of the value.
     * Return truthy for "deleted", falsy for "not present".
     */
    __delete__?(key: string | number): unknown;
    /** Invoked to render the value as a string (`print()`, `+`, `%s`, `%J`). */
    __tostring__?(): string;
    /** Legacy alias of `__tostring__`, which wins when both are present. */
    tostring?(): string;
}

/** The type of a value after assigning it the prototype `P` via `proto()`. */
type UcodeWithProto<T, P> = T &
    P &
    (P extends { __call__(...args: infer A): infer R } ? (...args: A) => R : unknown);

/**
 * The global environment. Augment this interface to declare additional
 * global variables:
 *
 * ```ts
 * declare global {
 *     interface UcodeGlobal {
 *         my_setting: string;
 *     }
 * }
 * ```
 */
interface UcodeGlobal {
    [name: string]: unknown;
}

// ---------------------------------------------------------------------------
// Global properties
// ---------------------------------------------------------------------------

/** The global environment object. */
declare const global: UcodeGlobal;

/**
 * Module cache used by `require()`, keyed by dotted module name. Delete an
 * entry to force a reload, add one to provide a "virtual" module.
 */
declare var modules: { [name: string]: unknown };

/**
 * Search path patterns used by `require()`. Each `*` is replaced by the
 * slash-separated module name, e.g. `/usr/share/ucode/*.uc`.
 */
declare var REQUIRE_SEARCH_PATH: string[];

/** Command line arguments passed to the script (set by the `ucode` CLI). */
declare var ARGV: string[];

/** Path of the executed script (set by the `ucode` CLI). */
declare var SCRIPT_NAME: string;

// These are keywords in ucode, but must be declared since `noLib` drops them.

/** Not-a-number double value. */
// oxlint-disable-next-line no-shadow-restricted-names
declare const NaN: number;

/** Positive infinity double value, e.g. the result of a division by zero. */
// oxlint-disable-next-line no-shadow-restricted-names
declare const Infinity: number;

// ---------------------------------------------------------------------------
// Builtin functions
// ---------------------------------------------------------------------------

/**
 * Convert an array of byte values to an IP address string. Arrays of
 * length 4 are converted to IPv4 addresses, arrays of length 16 to IPv6.
 *
 * Returns `null` if the array has any other length or contains values that
 * are not integers in the range 0..255.
 *
 * @example
 * arrtoip([ 192, 168, 1, 1 ])  // "192.168.1.1"
 * arrtoip([ 1, 2, 3 ])         // null (invalid length)
 */
declare function arrtoip(arr: readonly number[]): string | null;

/**
 * Raise an exception with the given message when `cond` is not truthy.
 *
 * @param message Defaults to `"Assertion failed"`.
 * @example
 * assert(true, "This is true");  // no exception
 * assert(false);                 // throws "Assertion failed"
 */
declare function assert(cond: unknown, message?: string): asserts cond;

/**
 * Decode a base64 encoded string.
 *
 * Returns `null` on non-base64 characters, invalid padding or trailing
 * garbage.
 *
 * @example
 * b64dec("VGhpcyBpcyBhIHRlc3Q=")  // "This is a test"
 * b64dec("XXX")                   // null
 */
declare function b64dec(str: string): string | null;

/**
 * Encode a string into base64.
 *
 * @example
 * b64enc("This is a test")  // "VGhpcyBpcyBhIHRlc3Q="
 */
declare function b64enc(str: string): string;

/**
 * Call a function with a modified environment.
 *
 * @param ctx The `this` context, `null` when omitted.
 * @param scope The global environment. When omitted or `null` the current
 * global environment is used. A dictionary without prototype inherits from
 * the current global environment; one with a prototype is kept as-is, which
 * allows sandboxing.
 * @param args Arguments forwarded to `fn`.
 * @returns The return value of `fn`. Exceptions thrown by `fn` propagate.
 * @example
 * call(function() { return this.x }, { x: 1 })          // 1
 * call(function() { return a }, null, { a: 2 })         // 2
 * call((x, y, z) => x * y * z, null, null, 2, 3, 4)     // 24
 */
declare function call<T, A extends unknown[], R>(
    fn: (this: T, ...args: A) => R,
    ctx?: T | null,
    scope?: object | null,
    ...args: A
): R;

/**
 * Convert each numeric value to a byte and return the resulting string.
 * Invalid values or values < 0 become `\0`, values > 255 are clamped to 255.
 *
 * @example
 * chr(65, 98, 99)  // "Abc"
 */
declare function chr(...bytes: number[]): string;

/**
 * Read the current second and nanosecond value of the system clock.
 *
 * @param monotonic Query the monotonic clock instead of the realtime clock.
 * @returns `[seconds, nanoseconds]`, or `null` when the monotonic clock is
 * requested but not implemented by the system.
 * @example
 * clock()      // [ 1647954926, 798269464 ]
 * clock(true)  // [ 474751, 527959975 ]
 */
declare function clock(monotonic?: false): [seconds: number, nanoseconds: number];
declare function clock(monotonic: boolean): [seconds: number, nanoseconds: number] | null;

/**
 * Raise an exception with the given message and abort execution.
 *
 * When passed an exception object (as caught by `catch`), the original
 * message and stacktrace are preserved, allowing clean re-throws.
 *
 * @example
 * try { inner(); } catch (e) { die(e); }
 */
declare function die(msg: string | Partial<UcodeException>): never;

/**
 * Check whether the given key exists within the given object.
 *
 * @example
 * let x = { foo: true, qrx: null };
 * exists(x, "foo")  // true
 * exists(x, "qrx")  // true
 * exists(x, "baz")  // false
 */
declare function exists<T extends object, K extends string>(
    obj: T,
    key: K,
): obj is T & Record<K, unknown>;

/**
 * Terminate the interpreter with the given exit code. Does not return.
 *
 * @example
 * exit();
 * exit(5);
 */
declare function exit(n?: number): never;

/**
 * Return a new array with the items of `arr` for which `fn` returns a
 * truthy value, in the same order.
 *
 * @example
 * filter([ "foo", "", "bar" ], length)  // [ "foo", "bar" ]
 */
declare function filter<T, S extends T>(
    arr: readonly T[],
    fn: (value: T, index: number, array: T[]) => value is S,
): S[];
declare function filter<T>(
    arr: readonly T[],
    fn: (value: T, index: number, array: T[]) => unknown,
): T[];

/**
 * Interact with the garbage collector.
 *
 * - `collect` (default): perform a complete cycle, returns `true`.
 * - `start`: (re-)start periodic collection every `interval` (1..65535,
 *   default 1000) steps. Returns `true` if it was stopped before or the
 *   interval changed.
 * - `stop`: stop periodic collection, returns `true` if it was running.
 * - `count`: return the amount of active complex object references.
 *
 * @example
 * gc()          // true
 * gc("start")   // true
 * gc("count")   // 42
 */
declare function gc(operation?: "collect"): boolean;
declare function gc(operation: "start", interval?: number): boolean;
declare function gc(operation: "stop"): boolean;
declare function gc(operation: "count"): number;

/**
 * Query an environment variable, or the entire environment when `name` is
 * omitted.
 */
declare function getenv(): { [name: string]: string };
declare function getenv(name: string): string | null;

/**
 * Like `localtime()` but interpreting the epoch as UTC.
 *
 * @param epoch Defaults to now.
 * @example
 * gmtime(1647953502)
 * // { sec: 42, min: 51, hour: 13, mday: 22, mon: 3, year: 2022,
 * //   wday: 2, yday: 81, isdst: 0 }
 */
declare function gmtime(epoch?: number): TimeSpec;

/**
 * Convert a hexadecimal string into a number. Returns `NaN` if the value
 * cannot be interpreted as hexadecimal number.
 */
declare function hex(x: string): number;

/**
 * Decode a hexadecimal digit string into a byte string.
 *
 * @param skipchars Characters to ignore, defaults to `" \t\n"`.
 * @returns `null` on invalid characters or an uneven amount of hex digits.
 * @example
 * hexdec("48656c6c6f20776f726c64210a")  // "Hello world!\n"
 * hexdec("44:55:66:77:33:44", ":")      // "DUfw3D"
 */
declare function hexdec(hexstring: string, skipchars?: string): string | null;

/**
 * Encode a byte string into a hexadecimal digit string.
 *
 * @example
 * hexenc("Hello world!\n")  // "48656c6c6f20776f726c64210a"
 */
declare function hexenc(val: string): string;

/**
 * Evaluate and include the file at the given path.
 *
 * @param scope Extends the scope available to the included file. Use
 * `proto(scope, {})` for a sandboxed scope without access to other globals.
 * @example
 * include("./foo.uc");
 * include("./supplemental.uc", { foo: true, bar: 123 });
 */
declare function include(path: string, scope?: object | null): void;

/**
 * Find the first occurrence of `needle` within a string or array.
 *
 * @param offset Index to begin the search at (bytes for strings, elements
 * for arrays). Negative values are relative to the end.
 * @returns The first matching index, or -1 if not found.
 * @example
 * index("hello world", "o")     // 4
 * index("hello world", "o", 5)  // 7
 * index([ 1, 2, 3, 1 ], 2)      // 1
 * index("foo", "bar")           // -1
 */
declare function index(str: string, needle: string, offset?: number | null): number;
declare function index<T>(arr: readonly T[], needle: NoInfer<T>, offset?: number | null): number;

/**
 * Convert a value to an integer, using an optional base. The base is ignored
 * if the value is already numeric.
 *
 * @param base Defaults to 10.
 * @returns The integer value, or `NaN` if not convertible.
 * @example
 * int("123")         // 123
 * int("10 or more")  // 10
 * int("12.3")        // 12
 * int("abc", 16)     // 2748
 * int("xyz", 16)     // NaN
 */
declare function int(x: unknown, base?: number): number;

/**
 * Convert an IP address string to an array of byte values (4 for IPv4,
 * 16 for IPv6). The inverse of `arrtoip()`.
 *
 * @returns `null` if the address is invalid.
 * @example
 * iptoarr("192.168.1.1")  // [ 192, 168, 1, 1 ]
 * iptoarr("foo")          // null
 */
declare function iptoarr(address: string): number[] | null;

/**
 * Join the array elements into a string, using `sep` as glue.
 *
 * @example
 * join(", ", [ "a", "b", "c" ])  // "a, b, c"
 */
declare function join(sep: string, arr: readonly unknown[]): string;

/**
 * Parse a string as JSON. When given an object or resource, its `read()`
 * method is called repeatedly to incrementally parse chunks until it
 * returns `null` or an empty string.
 *
 * Throws on parse errors, trailing garbage or premature EOF.
 *
 * @example
 * json('{"a":true, "b":123}')  // { a: true, b: 123 }
 * json(fs.open("example.json", "r"))
 */
declare function json<T = unknown>(str_or_resource: string | UcodeReadable): T;

/**
 * Return an array of all key names of the given object, in declaration or
 * assignment order.
 */
declare function keys(obj: object): string[];

/**
 * Convert a string to lowercase.
 *
 * @example
 * lc("HeLLo WoRLd!")  // "hello world!"
 */
declare function lc(s: string): string;

/**
 * Determine the length of a string (in bytes), array (amount of elements,
 * i.e. highest index + 1) or object (amount of keys).
 *
 * @example
 * length("test")           // 4
 * length([ true, null ])   // 2
 * length({ foo: true })    // 1
 */
declare function length(x: string | object): number;

/**
 * Compile the given file into a ucode program and return its entry
 * function. Throws on compilation or file I/O errors.
 *
 * @see loadstring
 * @example
 * loadfile("./templates/example.uc")  // function main() { ... }
 */
declare function loadfile(path: string, options?: ParseConfig): UcodeProgram;

/**
 * Compile the given code string into a ucode program and return its entry
 * function. Throws on compilation errors.
 *
 * @param options Parse options, defaults to those of the running program.
 * @example
 * let fn = loadstring("return 1 + 2;", { raw_mode: true });
 * fn();  // 3
 */
declare function loadstring(code: string, options?: ParseConfig): UcodeProgram;

/**
 * Return the given epoch (or now) as broken-down local time.
 *
 * @param epoch Defaults to now.
 * @example
 * localtime(1647953502)
 * // { sec: 42, min: 51, hour: 13, mday: 22, mon: 3, year: 2022,
 * //   wday: 2, yday: 81, isdst: 0 }
 */
declare function localtime(epoch?: number): TimeSpec;

/**
 * Trim characters from the start of the string.
 *
 * @param c Characters to trim, defaults to space, `\t`, `\r` and `\n`.
 * @example
 * ltrim("  foo  \n")     // "foo  \n"
 * ltrim("--bar--", "-")  // "bar--"
 */
declare function ltrim(s: string, c?: string): string;

/**
 * Return a new array with the results of calling `fn` on every item.
 *
 * Note that `fn` receives `(value, index, array)`, so passing builtins
 * with optional parameters such as `int` directly may not do what you
 * expect: use `(x) => int(x)` instead.
 *
 * @example
 * map([ "Apple", "Bean" ], length)  // [ 5, 4 ]
 */
declare function map<T, U>(arr: readonly T[], fn: (value: T, index: number, array: T[]) => U): U[];

/**
 * Match a string against a regular expression.
 *
 * Without the `g` flag, returns an array describing the first match (full
 * match followed by capture groups). With the `g` flag, returns an array
 * of such arrays for all matches: pass `string[][]` as type argument.
 *
 * @returns `null` if the pattern was not found.
 * @example
 * match("foobarbaz", /b.(.)/)                // [ "bar", "r" ]
 * match<string[][]>("foobarbaz", /b.(.)/g)   // [ [ "bar", "r" ], [ "baz", "z" ] ]
 */
declare function match<M extends string[] | string[][] = string[]>(
    str: string,
    pattern: RegExp,
): M | null;

/**
 * Return the largest of the given values, or `null` when called without
 * arguments.
 *
 * @example
 * max(5, 2.1, 3)            // 5
 * max("def", "abc", "ghi")  // "ghi"
 */
declare function max(): null;
declare function max<T>(value: T, ...values: T[]): T;

/**
 * Return the smallest of the given values, or `null` when called without
 * arguments.
 *
 * @example
 * min(5, 2.1, 3, 0.3)       // 0.3
 * min("def", "abc", "ghi")  // "abc"
 */
declare function min(): null;
declare function min<T>(value: T, ...values: T[]): T;

/**
 * Return the byte value of the character at `offset` (default 0). Negative
 * offsets count from the end.
 *
 * @returns `null` if the offset is invalid.
 * @example
 * ord("Abc")      // 65
 * ord("Abc", 1)   // 98
 * ord("Abc", 10)  // null
 */
declare function ord(s: string, offset?: number): number | null;

/**
 * Remove and return the last item of the array, or `null` if it is empty.
 *
 * @example
 * let x = [ 1, 2, 3 ];
 * pop(x);  // 3, x is now [ 1, 2 ]
 */
declare function pop<T>(arr: T[]): T | null;

/**
 * Print the given values to stdout and return the amount of bytes written.
 *
 * Strings are printed as-is, numbers in decimal notation, arrays and
 * objects as JSON (or through their `__tostring__` metamethod) and `null`
 * as an empty string.
 *
 * @example
 * print("Hello ", 123, "\n");
 */
declare function print(...values: unknown[]): number;

/**
 * Format the arguments according to `fmt` and print the result to stdout.
 * Returns the amount of bytes written.
 *
 * Supports the `d`, `i`, `o`, `u`, `x`, `X`, `e`, `E`, `f`, `F`, `g`,
 * `G`, `c` and `s` conversions, plus `J` which formats the value as JSON
 * (`%.J` pretty prints with tabs, `%.2J` with 2 spaces).
 *
 * @example
 * printf("Hello %s\n", "world");  // Hello world
 * printf("%08x\n", 123);          // 0000007b
 * printf("%2$d %1$d\n", 12, 34);  // 34 12
 * printf("%J", [ 1, 2, 3 ]);      // [ 1, 2, 3 ]
 */
declare function printf(fmt: string, ...args: unknown[]): number;

/**
 * Get or set the prototype of an array or object.
 *
 * With one argument, returns the current prototype or `null`. With two
 * arguments, sets `proto` as prototype of `val` and returns `val`. The
 * prototype may define metamethods (`__call__`, `__get__`, `__set__`,
 * `__delete__`, `__tostring__`).
 *
 * Throws if the prototype would create a circular chain.
 *
 * @example
 * const arr = [ 1, 2, 3 ];
 * proto(arr);                 // null
 * proto(arr, { foo: true });  // arr, now inheriting `foo`
 *
 * const adder = proto({ base: 10 }, {
 *     __call__(a, b) { return this.base + a + b; }
 * });
 * adder(1, 2);  // 13
 */
declare function proto(val: object): object | null;
declare function proto<T extends object, P extends UcodeMetamethods>(
    val: T,
    proto: P & ThisType<UcodeWithProto<T, P>>,
): UcodeWithProto<T, P>;

/**
 * Append the given values to the array.
 *
 * @returns The last pushed value, or `null` when no values were given.
 * @example
 * let x = [ 1, 2, 3 ];
 * push(x, 4, 5, 6);  // 6, x is now [ 1, 2, 3, 4, 5, 6 ]
 */
declare function push<T>(arr: T[]): null;
declare function push<T, V extends T>(arr: T[], ...values: [...T[], V]): V;

/**
 * Delete the own property `key` of `obj` without dispatching the
 * `__delete__` metamethod.
 *
 * @returns `true` if a property was deleted.
 */
declare function rawdelete(obj: object, key: string | number): boolean;

/**
 * Read property `key` of `obj` (own key, then prototype chain) without
 * dispatching the `__get__` metamethod.
 *
 * @returns The value, or `null` if not present.
 */
declare function rawget(obj: object, key: string | number): unknown;

/**
 * Store `value` as property `key` of `obj` without dispatching the
 * `__set__` metamethod. On arrays, only index keys are accepted.
 *
 * @returns The stored value, or `null` on failure.
 */
declare function rawset<V>(obj: object, key: string | number, value: V): V | null;

/**
 * Construct a regular expression from a pattern string.
 *
 * Throws a type error on unrecognized flags and a syntax error when the
 * pattern cannot be compiled.
 *
 * @param flags Any of `i` (ignore case), `s` (dotAll) and `g` (global).
 * @example
 * regexp("foo.*bar", "is")  // equivalent to /foo.*bar/is
 */
declare function regexp(source: string, flags?: string): RegExp;

/**
 * Capture the output of a template file or a function call as a string.
 *
 * With a path, acts like `include()` but returns the output. With a
 * function, calls it with the remaining arguments and returns its output
 * (its return value is discarded).
 *
 * @example
 * render("./template.uc", { foo: "bar" });
 * render(function(name) { printf("Hello, %s!\n", name); }, "Alice");
 */
declare function render(path: string, scope?: object | null): string;
declare function render<A extends unknown[]>(fn: (...args: A) => unknown, ...args: A): string;

/**
 * Replace occurrences of `pattern` in `str`.
 *
 * String patterns and regular expressions with the `g` flag replace all
 * occurrences, other regular expressions only the first one. `limit`
 * restricts the amount of substitutions.
 *
 * String replacements support `$$`, `` $` ``, `$&`, `$'` and `$1`..`$9`.
 * Callback replacements receive the matched substring followed by the
 * capture groups, and their result is converted to a string.
 *
 * @example
 * replace("barfoobaz", "a", "X")          // "bXrfoobXz"
 * replace("barfoobaz", /(f)(o+)/g, uc)    // "barFOObaz"
 * replace("aaaaa", "a", "x", 3)           // "xxxaa"
 */
declare function replace(
    str: string,
    pattern: RegExp | string,
    replace: string | ((match: string, ...groups: string[]) => unknown),
    limit?: number,
): string;

/**
 * Load and evaluate a ucode script or shared library extension at runtime,
 * searching `REQUIRE_SEARCH_PATH`. Results are cached in `modules`.
 *
 * Prefer compile time `import` statements unless runtime loading is needed.
 *
 * @param name Module name in dotted notation.
 * @example
 * const acme = require("example.acme");  // example/acme.uc or example/acme.so
 */
declare function require<T = unknown>(name: string): T;

/**
 * Reverse the order of an array or the bytes of a string, returning a new
 * value.
 *
 * @example
 * reverse([ 1, 2, 3 ])  // [ 3, 2, 1 ]
 * reverse("Abc")        // "cbA"
 */
declare function reverse(str: string): string;
declare function reverse<T>(arr: readonly T[]): T[];

/**
 * Find the last occurrence of `needle` within a string or array.
 *
 * @param offset Upper bound: only indexes less than or equal to it are
 * considered. Negative values are relative to the end.
 * @returns The last matching index, or -1 if not found.
 * @example
 * rindex("hello world", "o")     // 7
 * rindex("hello world", "o", 5)  // 4
 */
declare function rindex(str: string, needle: string, offset?: number | null): number;
declare function rindex<T>(arr: readonly T[], needle: NoInfer<T>, offset?: number | null): number;

/**
 * Trim characters from the end of the string.
 *
 * @param c Characters to trim, defaults to space, `\t`, `\r` and `\n`.
 * @example
 * rtrim("  foo  \n")     // "  foo"
 * rtrim("--bar--", "-")  // "--bar"
 */
declare function rtrim(str: string, c?: string): string;

/**
 * Remove and return the first item of the array, or `null` if it is empty.
 *
 * @example
 * let x = [ 1, 2, 3 ];
 * shift(x);  // 1, x is now [ 2, 3 ]
 */
declare function shift<T>(arr: T[]): T | null;

/**
 * Query or set a process signal handler.
 *
 * Signals may be given as number or as case-insensitive name, with or
 * without `SIG` prefix. Handlers are invoked with the signal number at the
 * next opportunity of the VM, not immediately.
 *
 * @returns The (new) handler, or `null` on an invalid signal/handler or
 * when changing the action failed.
 * @example
 * signal("INT", "ignore");     // "ignore"
 * signal(9, "ignore");         // null (SIGKILL cannot be ignored)
 * signal("SIGINT", (signo) => exit(1));
 */
declare function signal(signal: number | string): UcodeSignalHandler | null;
declare function signal<H extends UcodeSignalHandler>(
    signal: number | string,
    handler: H,
): H | null;

/**
 * Pause execution for the given amount of milliseconds.
 *
 * @example
 * sleep(1000);
 */
declare function sleep(milliseconds: number): boolean;

/**
 * Return a shallow copy of a portion of the array from `off` up to (not
 * including) `end`. Negative offsets count from the end.
 *
 * @example
 * slice([ 1, 2, 3 ], 1)       // [ 2, 3 ]
 * slice([ 1, 2, 3 ], -3, -1)  // [ 1, 2 ]
 */
declare function slice<T>(arr: readonly T[], off?: number, end?: number): T[];

/**
 * Sort an array in place, or reorder the keys of an object in place.
 *
 * The comparator returns a value lower than, equal to or larger than zero.
 * For objects it receives the two keys followed by their two values.
 * Without comparator, an ascending order (by key for objects) is applied.
 *
 * @returns The sorted input value.
 * @example
 * sort([ 8, 1, 5, 9 ])                          // [ 1, 5, 8, 9 ]
 * sort([ "Bean", "Apple" ], (a, b) => length(a) - length(b))
 * sort(inventory, (k1, k2, v1, v2) => v2 - v1)  // by value, descending
 */
declare function sort<T>(arr: T[], fn?: (a: T, b: T) => number): T[];
declare function sort<T extends object>(
    obj: T,
    fn?: (k1: string, k2: string, v1: T[keyof T], v2: T[keyof T]) => number,
): T;

/**
 * Determine the path of the source file currently being executed.
 *
 * @param depth How far to walk up the call stack, defaults to 0.
 * @param dironly Return only the directory portion of the path.
 * @example
 * sourcepath()         // path of the current file
 * sourcepath(1, true)  // directory of the calling file
 */
declare function sourcepath(depth?: number, dironly?: boolean): string | null;

/**
 * Remove `len` elements (default: all remaining) starting at `off` from the
 * array and insert the given elements in their place.
 *
 * @returns The modified input array.
 * @example
 * let x = [ 1, 2, 3, 4 ];
 * splice(x, 1, 2, "a", "b", "c");  // [ 1, "a", "b", "c", 4 ]
 */
declare function splice<T>(arr: T[], off: number, len?: number, ...elements: T[]): T[];

/**
 * Split a string by a separator string or regular expression.
 *
 * @param limit Maximum amount of resulting pieces.
 * @example
 * split("foo,bar,baz", ",")     // [ "foo", "bar", "baz" ]
 * split("foobar", "")           // [ "f", "o", "o", "b", "a", "r" ]
 * split("foo=bar=baz", "=", 2)  // [ "foo", "bar=baz" ]
 */
declare function split(str: string, sep: string | RegExp, limit?: number): string[];

/**
 * Format the arguments according to `fmt` and return the resulting string.
 *
 * @see printf
 * @example
 * sprintf("Hello %s", "world")  // "Hello world"
 * sprintf("%J", [ 1, 2, 3 ])    // "[1,2,3]"
 */
declare function sprintf(fmt: string, ...args: unknown[]): string;

/**
 * Extract a substring. Negative `off` starts from the end, negative `len`
 * leaves that many characters off the end, omitted `len` means "until the
 * end".
 *
 * @example
 * s = "The black cat climbed the green tree";
 * substr(s, 4, 5);    // "black"
 * substr(s, 4, -11);  // "black cat climbed the"
 * substr(s, -4);      // "tree"
 */
declare function substr(str: string, off: number, len?: number): string;

/**
 * Execute a command, wait for completion and return its exit code.
 *
 * A string command is run through `/bin/sh -c`, an array is used as
 * `execv()` argument vector.
 *
 * @param timeout Kill the program with SIGKILL after that many milliseconds.
 * `0` or omitted disables the timeout.
 * @returns The exit code, or the negative signal number when the program
 * was terminated by a signal.
 * @example
 * system("echo 'Hello world' && exit 3");  // 3
 * system([ "/usr/bin/date", "+%s" ]);      // 0
 * system("sleep 3", 1000);                 // -9
 */
declare function system(command: string | readonly string[], timeout?: number): number;

/** Return the current UNIX epoch. */
declare function time(): number;

/**
 * Like `timelocal()` but interpreting the date time specification as UTC.
 *
 * @example
 * timegm({ sec: 42, min: 51, hour: 13, mday: 22, mon: 3, year: 2022 })  // 1647953502
 */
declare function timegm(datetimespec: Partial<TimeSpec>): number | null;

/**
 * Convert a broken-down local date time into an epoch value, the inverse of
 * `localtime()`. `wday` and `yday` are ignored, out of range values are
 * normalized.
 *
 * @returns The epoch, or `null` if the specification is invalid or cannot
 * be represented.
 */
declare function timelocal(datetimespec: Partial<TimeSpec>): number | null;

/**
 * Enable (positive level) or disable (`0`) VM opcode tracing to stderr.
 */
declare function trace(level: number): void;

/**
 * Trim characters from the start and end of the string.
 *
 * @param c Characters to trim, defaults to space, `\t`, `\r` and `\n`.
 */
declare function trim(str: string, c?: string): string;

/**
 * Query the type of a value.
 *
 * @returns The type name, or `null` for `null`.
 * @example
 * type(1)      // "int"
 * type(1.5)    // "double"
 * type([])     // "array"
 * type(null)   // null
 */
declare function type(x: unknown): UcodeTypeName | null;

/**
 * Convert a string to uppercase.
 *
 * @example
 * uc("hello")  // "HELLO"
 */
declare function uc(str: string): string;

/**
 * Convert each codepoint to its UTF-8 multibyte sequence and return the
 * resulting string. Invalid values become U+FFFD.
 *
 * @example
 * uchr(0x2600, 0x26C6, 0x2601)  // "☀⛆☁"
 */
declare function uchr(...codepoints: number[]): string;

/**
 * Return a new array with the unique values of the input, preserving order.
 *
 * @example
 * uniq([ 1, true, "foo", 2, true, "foo" ])  // [ 1, true, "foo", 2 ]
 */
declare function uniq<T>(array: readonly T[]): T[];

/**
 * Prepend the given values to the array.
 *
 * @returns The last value added, or `null` when no values were given.
 * @example
 * let x = [ 3, 4, 5 ];
 * unshift(x, 1, 2);  // 2, x is now [ 1, 2, 3, 4, 5 ]
 */
declare function unshift<T>(arr: T[]): null;
declare function unshift<T, V extends T>(arr: T[], ...values: [...T[], V]): V;

/**
 * Return an array of all values of the given object, in key order.
 *
 * @example
 * values({ foo: true, bar: false })  // [ true, false ]
 */
declare function values<T extends object>(obj: T): T[keyof T][];

/**
 * Print the given values to stderr and return the amount of bytes written.
 * Arrays and objects are printed as JSON.
 */
declare function warn(...values: unknown[]): number;

/**
 * Match a value against a wildcard (file glob) pattern.
 *
 * @param nocase Perform case-insensitive matching.
 * @example
 * wildcard("file.txt", "*.txt")        // true
 * wildcard("file.txt", "*.TXT", true)  // true
 */
declare function wildcard(subject: unknown, pattern: string, nocase?: boolean): boolean;
