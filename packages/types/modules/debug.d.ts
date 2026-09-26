/**
 * Debugger Module
 *
 * The `debug` module provides runtime debug functionality for ucode scripts.
 *
 * Upon loading, it registers a SIGUSR2 handler writing a memory dump to
 * `/tmp/ucode.$timestamp.$pid.memdump`. Set `UCODE_DEBUG_MEMDUMP_ENABLED=0`
 * to disable it, `UCODE_DEBUG_MEMDUMP_SIGNAL` and `UCODE_DEBUG_MEMDUMP_PATH`
 * to override the signal and output directory.
 *
 * @example
 * import { memdump, traceback } from 'debug';
 * let stacktrace = traceback(1);
 * memdump("/tmp/dump.txt");
 *
 * @see https://ucode.mein.io/module-debug.html
 */
declare module "debug" {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    /** Information about a local variable, returned by `getlocal()` and `setlocal()`. */
    export interface LocalInfo {
        /** The index of the local variable. */
        index: number;
        /** The name of the local variable. */
        name: string;
        /** The current value of the local variable. */
        value: unknown;
        /** The source line number of the local variable declaration. */
        linefrom: number;
        /** The source line offset of the local variable declaration. */
        bytefrom: number;
        /** The source line number where the local variable goes out of scope. */
        lineto: number;
        /** The source line offset where the local variable goes out of scope. */
        byteto: number;
    }

    /** Source position of a call site, returned by `sourcepos()`. */
    export interface SourcePosition {
        /** The name of the source file. */
        filename: string;
        /** The source line. */
        line: number;
        /** The source line offset. */
        byte: number;
    }

    /** An entry of the call stack, returned by `traceback()`. */
    export interface StackTraceEntry {
        /** The function that was called. */
        callee: (...args: never[]) => unknown;
        /** The `this` context the function was called with. */
        this: unknown;
        /** Whether the function was invoked as a method. */
        mcall: boolean;
        /** Whether the VM was running in strict mode (ucode calls only). */
        strict?: boolean;
        /** The name of the calling source file (ucode calls only). */
        filename?: string;
        /** The source line of the call (ucode calls only). */
        line?: number;
        /** The source line offset of the call (ucode calls only). */
        byte?: number;
        /** The surrounding source code as human-readable string (ucode calls only). */
        context?: string;
    }

    /** Information about a captured variable, returned by `getupval()` and `setupval()`. */
    export interface UpvalInfo {
        /** The index of the captured variable. */
        index: number;
        /** The name of the captured variable. */
        name: string;
        /** Whether the function outlived the declaration scope of the variable. */
        closed: boolean;
        /** The current value of the captured variable. */
        value: unknown;
    }

    /** Reference to a captured variable, as listed in `ValueInformation.upvals`. */
    export interface UpvalRef {
        /** The name of the captured variable. */
        name: string;
        /** Whether the function outlived the declaration scope of the variable. */
        closed: boolean;
        /** The current value of the captured variable. */
        value: unknown;
        /** The stack slot of the variable, only for open (non-closed) upvalues. */
        slot?: number;
    }

    /** Internal type names reported by `getinfo()`. */
    export type ValueTypeName =
        | "integer"
        | "boolean"
        | "string"
        | "double"
        | "array"
        | "object"
        | "regexp"
        | "cfunction"
        | "closure"
        | "upvalue"
        | "resource";

    /** Internal information about a value, returned by `getinfo()`. */
    export interface ValueInformation {
        /**
         * The name of the value type. For resource values this is the
         * resource type name instead, e.g. `"fs.file"`.
         */
        type: ValueTypeName | (string & {});
        /** The value itself. */
        value: unknown;
        /** Whether the value is stored as tagged pointer, without heap allocation. */
        tagged: boolean;
        /** Whether the mark bit is set (non-tagged values only). */
        mark?: boolean;
        /** The current reference count, always at least 2 (non-tagged values only). */
        refcount?: number;
        /** Whether the number is stored as unsigned integer (non-tagged integers only). */
        unsigned?: boolean;
        /** The address of the underlying C heap memory. */
        address?: number;
        /** The length of the underlying string memory (strings only). */
        length?: number;
        /** The amount of elements (arrays and objects only). */
        count?: number;
        /** Whether the value is constant (arrays and objects only). */
        constant?: boolean;
        /** The associated prototype (arrays, objects and prototypes only). */
        prototype?: unknown;
        /** The original regex source pattern (regexps only). */
        source?: string;
        /** Whether the `i` flag is set (regexps only). */
        icase?: boolean;
        /** Whether the `g` flag is set (regexps only). */
        global?: boolean;
        /** Whether the `s` flag is set (regexps only). */
        newline?: boolean;
        /** The amount of capture groups (regexps only). */
        nsub?: number;
        /** The function name, `null` for anonymous functions (functions only). */
        name?: string | null;
        /** Whether the function is an arrow function (closures only). */
        arrow?: boolean;
        /** Whether the function is a module entry point (closures only). */
        module?: boolean;
        /** Whether the function body executes in strict mode (closures only). */
        strict?: boolean;
        /** Whether the function takes a variable number of arguments (closures only). */
        vararg?: boolean;
        /** The number of expected arguments, excluding a final ellipsis (closures only). */
        nargs?: number;
        /** The argument names in declaration order (closures only). */
        argnames?: string[];
        /** The number of upvalues (closures only). */
        nupvals?: number;
        /** Upvalue information (closures only). */
        upvals?: UpvalRef[];
        /** The source file the function was declared in (closures only). */
        filename?: string;
        /** The source line the function was declared at (closures only). */
        line?: number;
        /** The source line offset the function was declared at (closures only). */
        byte?: number;
    }

    // -----------------------------------------------------------------------
    // Functions
    // -----------------------------------------------------------------------

    /**
     * Install a user breakpoint from a location specification, using the
     * grammar of the interactive `break` command: `path[:line[:offset]]`, a
     * bare function name or an expression evaluating to a function.
     *
     * @param mainfn The program entry function, used to resolve bare
     * function names when there is no active call frame yet.
     * @returns The installed breakpoint id, or `false` on failure.
     */
    export function breakpoint(
        spec: string,
        mainfn?: (...args: never[]) => unknown,
    ): number | false;

    /**
     * Initialize the interactive debugger and start it immediately or, when
     * a function is given, as soon as that function is entered.
     *
     * `debugger` is a reserved word, so use a namespace import or a renamed
     * named import.
     *
     * @example
     * import * as debug from 'debug';
     * debug.debugger();      // launch immediately
     * debug.debugger(test);  // break before the first instruction of test()
     */
    function debuggerFn(target?: (...args: never[]) => unknown): void;
    export { debuggerFn as debugger };

    /**
     * Return internal information about a value, such as its reference count
     * or mark bit state. Returns `null` for `null`.
     */
    export function getinfo(value: unknown): ValueInformation | null;

    /**
     * Retrieve information about a local variable at the given call stack
     * depth.
     *
     * @param level Stack levels up: `0` is `getlocal()` itself, `1` (the
     * default, used when `null`) the calling function.
     * @param variable The variable name or its declaration order index.
     * @returns `null` if the level exceeds the call stack, refers to a C
     * call, or the variable is not found.
     */
    export function getlocal(level: number | null, variable: string | number): LocalInfo | null;

    /**
     * Retrieve information about a captured variable (upvalue).
     *
     * @param target A closure, or a stack depth selecting the closure that
     * many levels up.
     * @param variable The variable name or its declaration order index.
     * @returns `null` if the target is not a closure or the variable is not
     * found.
     */
    export function getupval(
        target: ((...args: never[]) => unknown) | number,
        variable: string | number,
    ): UpvalInfo | null;

    /**
     * Write a human readable memory dump of the values managed by the VM,
     * useful to track down logical memory leaks.
     *
     * @param file A file path, a file descriptor number, or a handle with a
     * `fileno()` method (e.g. `fs.file`, `fs.proc`, `uloop.handle`,
     * `socket.socket`).
     * @returns `null` if the file could not be opened or the handle is
     * invalid.
     */
    export function memdump(file: string | number | { fileno(): number | null }): boolean | null;

    /**
     * Notify an attached remote debugger client that the target is about to
     * exit. Called by the interpreter after the program finished.
     *
     * @param status The `uc_vm_status_t` value returned by `uc_vm_execute()`.
     * @param exitCode The exit code, meaningful for `STATUS_EXIT` only.
     * @param exception The exception object, meaningful for compile and
     * runtime errors only.
     */
    export function notifyExit(
        status: number,
        exitCode: number,
        exception?: UcodeException | null,
    ): void;

    /**
     * Set the value of a local variable at the given call stack depth.
     *
     * @param level Stack levels up: `0` is `setlocal()` itself, `1` (the
     * default, used when `null`) the calling function.
     * @param variable The variable name or its declaration order index.
     * @param value Defaults to `null`.
     * @returns Information about the updated variable, or `null` on failure.
     */
    export function setlocal(
        level: number | null,
        variable: string | number,
        value?: unknown,
    ): LocalInfo | null;

    /**
     * Set the value of a captured variable (upvalue).
     *
     * @param target A closure, or a stack depth selecting the closure that
     * many levels up.
     * @param variable The variable name or its declaration order index.
     * @returns Information about the updated variable, or `null` on failure.
     */
    export function setupval(
        target: ((...args: never[]) => unknown) | number,
        variable: string | number,
        value: unknown,
    ): UpvalInfo | null;

    /**
     * Return the source position of the call site, or `null` when invoked
     * from C code.
     */
    export function sourcepos(): SourcePosition | null;

    /**
     * Capture the current call stack.
     *
     * @param level Call frames up the trace should start: `0` is
     * `traceback()` itself, `1` (the default) the calling function.
     */
    export function traceback(level?: number): StackTraceEntry[];
}
