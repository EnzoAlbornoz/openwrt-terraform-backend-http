import { defineConfig } from "tsdown";

import { ucodeTemplate } from "./tools/rolldown-plugin-ucode.ts";

export default defineConfig({
    entry: ["src/index.ts"],
    platform: "neutral",
    format: "esm",
    // ucodeTemplate() wraps the chunk in `{% %}` as the last step; anything
    // appended afterwards (e.g. a sourceMappingURL comment) would land outside
    // the block.
    sourcemap: false,
    dts: false,
    outExtensions: () => ({ js: ".uc" }),
    // Leave bare imports (fs, uci, luci.http, ...) as static imports; ucode
    // loads them from its module search path (extend it with `ucode -L`).
    deps: { neverBundle: true },
    plugins: [ucodeTemplate()],
});
