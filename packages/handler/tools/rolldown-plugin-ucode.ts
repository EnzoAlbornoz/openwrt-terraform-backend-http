import type { Rolldown } from "tsdown";

type Program = ReturnType<Rolldown.PluginContext["parse"]>;

interface Edit {
    start: number;
    end: number;
    text: string;
}

/**
 * Turns rolldown's output into a ucode template for uhttpd:
 *
 * - Integer literals are printed in decimal. Rolldown always prints `1000` as
 *   `1e3`, which ucode parses as a double (`1e3 / 3` is `333.33`, not `333`).
 * - The chunk is wrapped in a single `{% ... %}` block, since uhttpd parses
 *   the handler in template mode.
 * - The build fails on identifiers ucode cannot parse (see
 *   `invalidIdentifiers()`).
 *
 * This runs in `generateBundle` because tsdown's default minify pass reprints
 * the output of `renderChunk` (undoing the literal fix), and `postBanner` is
 * already part of the code by `generateBundle` (so it can't be parsed there).
 */
export function ucodeTemplate(): Rolldown.Plugin {
    return {
        name: "ucode-template",

        generateBundle(_options, bundle) {
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== "chunk") continue;

                const program = this.parse(chunk.code);
                const invalid = invalidIdentifiers(program);

                if (invalid.length > 0)
                    this.error(
                        `${chunk.fileName}: identifiers invalid in ucode: ${invalid.join(", ")}`,
                    );

                const edits = integerLiteralEdits(program);

                // Nothing may precede `{%`: text outside the block is printed
                // rather than executed.
                chunk.code = `{%\n"use strict";\n${applyEdits(chunk.code, edits)}\n%}`;
            }
        },
    };
}

/** Calls `visit` for every AST node. */
function walk(program: Program, visit: (node: Record<string, unknown>) => void): void {
    const pending: unknown[] = [program];

    while (pending.length > 0) {
        const value = pending.pop();

        if (Array.isArray(value)) {
            pending.push(...value);
            continue;
        }
        if (typeof value !== "object" || value === null) continue;

        const node = value as Record<string, unknown>;

        visit(node);
        pending.push(...Object.values(node));
    }
}

/**
 * Identifiers ucode cannot parse: it only allows letters, digits and `_`,
 * but rolldown deconflicts names by appending `$1` (e.g. when two modules
 * import `error` from different ucode modules). Import one of them as a
 * namespace (`import * as uci from "uci"`) to avoid the clash.
 */
function invalidIdentifiers(program: Program): string[] {
    const names = new Set<string>();

    walk(program, (node) => {
        if (
            node["type"] === "Identifier" &&
            !/^[A-Za-z_][A-Za-z0-9_]*$/.test(node["name"] as string)
        )
            names.add(node["name"] as string);
    });

    return [...names];
}

/** Reprints integer-valued numeric literals (`1e3`, `0x10`) in decimal. */
function integerLiteralEdits(program: Program): Edit[] {
    const edits: Edit[] = [];

    walk(program, (node) => {
        if (
            node["type"] === "Literal" &&
            typeof node["value"] === "number" &&
            Number.isSafeInteger(node["value"]) &&
            node["raw"] !== String(node["value"])
        ) {
            edits.push({
                start: node["start"] as number,
                end: node["end"] as number,
                text: String(node["value"]),
            });
        }
    });

    return edits;
}

function applyEdits(code: string, edits: Edit[]): string {
    let result = code;

    for (const { start, end, text } of edits.toSorted((a, b) => b.start - a.start)) {
        result = result.slice(0, start) + text + result.slice(end);
    }

    return result;
}
