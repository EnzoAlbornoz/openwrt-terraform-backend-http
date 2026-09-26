/**
 * Preloaded by `node --test` (`--import`) to run the handler sources on Node:
 *
 * - installs the ucode builtins as globals;
 * - resolves the ucode modules (`fs`, `digest`, `uci`) imported from `src/` to the
 *   stand-ins in `ucode/`, instead of Node's own `fs`;
 * - resolves the `./module.js` imports of `src/` to their `.ts` sources, as
 *   the bundler does.
 */

import { registerHooks } from "node:module";

import { installRuntime } from "./ucode/runtime.ts";

const SOURCES = new URL("../src/", import.meta.url).href;

const MODULES: Record<string, string> = {
    fs: new URL("./ucode/fs.ts", import.meta.url).href,
    digest: new URL("./ucode/digest.ts", import.meta.url).href,
    uci: new URL("./ucode/uci.ts", import.meta.url).href,
};

installRuntime();

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (context.parentURL?.startsWith(SOURCES)) {
            const module = MODULES[specifier];

            if (module != null) return { url: module, shortCircuit: true };

            if (specifier.startsWith(".") && specifier.endsWith(".js"))
                return nextResolve(specifier.slice(0, -3) + ".ts", context);
        }

        return nextResolve(specifier, context);
    },
});
