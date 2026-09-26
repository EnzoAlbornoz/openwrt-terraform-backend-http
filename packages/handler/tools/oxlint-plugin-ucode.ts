/**
 * Oxlint plugin rejecting TypeScript/JavaScript syntax that ucode does not
 * support, or that bundles into code ucode cannot run.
 *
 * The constructs below were checked against the ucode compiler: each one is
 * either a syntax error in ucode or silently behaves differently there.
 * Syntax that bundling rewrites into something ucode accepts (numeric
 * separators, `\u{...}` escapes, trailing commas, ASI) is not reported.
 *
 * @see https://ucode.mein.io/tutorial-02-syntax.html
 */

// Minimal shapes of the ESTree nodes and rule context oxlint hands to plugins.
interface Node {
    type: string;
    parent?: Node;
    [key: string]: unknown;
}

interface Context {
    report(diagnostic: { node: Node; message: string }): void;
}

type Visitor = Record<string, (node: Node) => void>;

const syntaxRule = {
    meta: {
        type: "problem",
        docs: { description: "Disallow syntax that ucode does not support." },
    },
    create(context: Context): Visitor {
        const report = (node: Node, message: string) => context.report({ node, message });

        const checkFunction = (node: Node) => {
            if (node["async"]) report(node, "ucode has no async functions or promises.");
            if (node["generator"]) report(node, "ucode has no generator functions.");
        };

        const checkPattern = (node: Node) => {
            // Report the outermost pattern only.
            if (node.parent?.type === "Property" || node.parent?.type.endsWith("Pattern")) return;
            report(node, "ucode has no destructuring; access properties explicitly.");
        };

        return {
            ClassDeclaration: (node) =>
                report(node, "ucode has no classes; use object literals and functions."),
            ClassExpression: (node) =>
                report(node, "ucode has no classes; use object literals and functions."),
            NewExpression: (node) => report(node, "ucode has no `new`; use factory functions."),
            ForOfStatement: (node) =>
                report(node, "ucode has no for...of; use an index loop or map()/filter()."),
            DoWhileStatement: (node) => report(node, "ucode has no do...while; use while."),
            LabeledStatement: (node) => report(node, "ucode has no labeled statements."),
            ThrowStatement: (node) => report(node, "ucode has no `throw`; use die(message)."),
            TryStatement: (node) => {
                if (node["finalizer"]) report(node, "ucode has no `finally` block.");
            },
            FunctionDeclaration: checkFunction,
            FunctionExpression: checkFunction,
            ArrowFunctionExpression: checkFunction,
            AssignmentPattern: (node) =>
                report(node, "ucode has no default values for parameters or bindings."),
            ObjectPattern: checkPattern,
            ArrayPattern: checkPattern,
            Property: (node) => {
                if (node["kind"] === "get" || node["kind"] === "set") {
                    report(node, "ucode has no getters or setters.");
                }
            },
            TaggedTemplateExpression: (node) => report(node, "ucode has no tagged templates."),
            UnaryExpression: (node) => {
                if (node["operator"] === "typeof")
                    report(node, "ucode has no `typeof`; use type(value).");
                if (node["operator"] === "void") report(node, "ucode has no `void` operator.");
            },
            BinaryExpression: (node) => {
                if (node["operator"] === "instanceof")
                    report(node, "ucode has no `instanceof`; use type(value).");
                if (node["operator"] === ">>>") report(node, "ucode has no `>>>` operator.");
            },
            AssignmentExpression: (node) => {
                if (node["operator"] === ">>>=") report(node, "ucode has no `>>>=` operator.");
            },
            Literal: (node) => {
                if (node["bigint"] !== undefined)
                    report(node, "ucode has no BigInt; integers are 64-bit.");
            },
            MetaProperty: (node) => report(node, "ucode has no `import.meta` or `new.target`."),
            ImportExpression: (node) =>
                report(
                    node,
                    "ucode's import() returns the module synchronously, not a Promise; use a static import.",
                ),
            TSEnumDeclaration: (node) => {
                if (!node["declare"])
                    report(node, "enums compile to `var` and IIFEs; use an `as const` object.");
            },
            TSModuleDeclaration: (node) => {
                if (!node["declare"] && node["kind"] === "namespace") {
                    report(node, "namespaces compile to `var` and IIFEs; use modules.");
                }
            },
        };
    },
};

/**
 * ucode compiles regular expressions with POSIX `regcomp()` (extended
 * syntax), plus the `\d`, `\w`, `\s` and `\b` shorthands.
 */
function regexProblems(pattern: string, flags: string): string[] {
    const problems = new Set<string>();

    for (const flag of flags) {
        if (!"gis".includes(flag)) problems.add(`the \`${flag}\` flag (only g, i and s exist)`);
    }

    let inClass = false;

    for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        const next = pattern[i + 1];

        if (char === "\\") {
            if (!inClass && next !== undefined && next >= "1" && next <= "9")
                problems.add("back-references");
            i++;
        } else if (inClass) {
            if (char === "]") inClass = false;
        } else if (char === "[") {
            inClass = true;
        } else if (char === "(" && next === "?") {
            problems.add("`(?...)` groups (lookaround, non-capturing and named groups)");
            i++;
        } else if ("*+?}".includes(char ?? "") && next === "?") {
            // POSIX quantifiers are always greedy; the `?` is silently ignored.
            problems.add("lazy quantifiers");
            i++;
        }
    }

    return [...problems];
}

const regexRule = {
    meta: {
        type: "problem",
        docs: {
            description: "Disallow regular expression features ucode's POSIX regex engine lacks.",
        },
    },
    create(context: Context): Visitor {
        return {
            Literal: (node) => {
                const regex = node["regex"] as { pattern: string; flags: string } | undefined;
                if (!regex) return;

                for (const problem of regexProblems(regex.pattern, regex.flags)) {
                    context.report({
                        node,
                        message: `ucode regular expressions do not support ${problem}.`,
                    });
                }
            },
        };
    },
};

export default {
    meta: { name: "ucode" },
    rules: {
        "no-unsupported-syntax": syntaxRule,
        "no-unsupported-regex": regexRule,
    },
};
