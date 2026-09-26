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

                const edits = integerLiteralEdits(this.parse(chunk.code));

                // Nothing may precede `{%`: text outside the block is printed
                // rather than executed.
                chunk.code = `{%\n"use strict";\n${applyEdits(chunk.code, edits)}\n%}`;
            }
        },
    };
}

/** Reprints integer-valued numeric literals (`1e3`, `0x10`) in decimal. */
function integerLiteralEdits(program: Program): Edit[] {
    const edits: Edit[] = [];
    const pending: unknown[] = [program];

    while (pending.length > 0) {
        const value = pending.pop();

        if (Array.isArray(value)) {
            pending.push(...value);
            continue;
        }
        if (typeof value !== "object" || value === null) continue;

        const node = value as Record<string, unknown>;

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
            continue;
        }

        pending.push(...Object.values(node));
    }

    return edits;
}

function applyEdits(code: string, edits: Edit[]): string {
    let result = code;

    for (const { start, end, text } of edits.toSorted((a, b) => b.start - a.start)) {
        result = result.slice(0, start) + text + result.slice(end);
    }

    return result;
}
