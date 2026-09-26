import { defineConfig } from "tsdown";

// uhttpd loads ucode handlers in template mode: everything outside `{% ... %}`
// is emitted as literal text. Wrap the whole bundle in a single statement block.
export default defineConfig({
    entry: ["src/index.ts"],
    platform: "neutral",
    format: "esm",
    // Anything the bundler appends after the footer (e.g. a sourceMappingURL
    // comment) would land outside the block and be printed as text.
    sourcemap: false,
    dts: false,
    outExtensions: () => ({ js: ".uc" }),
    // The banner must be the very first bytes of the file: any leading
    // whitespace would be written to the response as template text.
    banner: '{%\n"use strict";\n',
    footer: "%}",
});
