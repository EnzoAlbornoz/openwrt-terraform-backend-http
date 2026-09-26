/**
 * Mathematical Functions
 *
 * The `math` module bundles various mathematical and trigonometrical
 * functions. Arguments that cannot be converted to numbers yield `NaN`.
 *
 * @example
 * import { pow, rand } from 'math';
 * let x = pow(2, 5);
 * let y = rand();
 *
 * @see https://ucode.mein.io/module-math.html
 */
declare module "math" {
    /** Return the absolute value of `x`. */
    export function abs(x: number): number;

    /**
     * Calculate the arc cosine of `x`, in radians, in the range [0, pi].
     *
     * @example
     * acos(-1)  // 3.1415926535898
     * acos(1)   // 0.0
     */
    export function acos(x: number): number;

    /**
     * Calculate the arc sine of `x`, in radians, in the range [-pi/2, pi/2].
     *
     * @example
     * asin(1)  // 1.5707963267949
     */
    export function asin(x: number): number;

    /**
     * Calculate the arc tangent of `x`, in radians, in the range
     * [-pi/2, pi/2].
     */
    export function atan(x: number): number;

    /**
     * Calculate the arc tangent of `y / x`, in radians, using the signs of
     * both arguments to determine the quadrant. The result is in the range
     * [-pi, pi].
     */
    export function atan2(y: number, x: number): number;

    /**
     * Calculate the cube root of `x`.
     *
     * @example
     * cbrt(27)  // 3.0
     */
    export function cbrt(x: number): number;

    /**
     * Return the smallest integral value not less than `x`.
     *
     * @param output_type `true` to return a double, integer otherwise.
     * @example
     * ceil(2.7)        // 3
     * ceil(2.7, true)  // 3.0
     * ceil(-2.7)       // -2
     */
    export function ceil(x: number, output_type?: boolean): number;

    /**
     * Clamp `x` to within `lower` and `upper`, i.e.
     * `min(upper, max(x, lower))`.
     *
     * @example
     * clamp(1000, 200, 180)  // 200.0
     * clamp(190, 200, 180)   // 190.0
     */
    export function clamp(x: number, upper: number, lower: number): number;

    /**
     * Return a double with the magnitude of `x` and the sign of `y`.
     *
     * @example
     * copysign(8, -5)  // -8.0
     */
    export function copysign(x: number, y: number): number;

    /** Calculate the cosine of `x`, given in radians. */
    export function cos(x: number): number;

    /** Calculate the hyperbolic cosine of `x`. */
    export function cosh(x: number): number;

    /**
     * Convert degrees to radians.
     *
     * @example
     * deg2rad(180)  // 3.1415926535898
     */
    export function deg2rad(x: number): number;

    /** Calculate e raised to the power of `x`. */
    export function exp(x: number): number;

    /**
     * Calculate e raised to the power of `x`, minus 1. More accurate than
     * `exp(x) - 1` for `x` close to zero.
     */
    export function expm1(x: number): number;

    /**
     * Return the largest integral value not greater than `x`.
     *
     * @param output_type `true` to return a double, integer otherwise.
     * @example
     * floor(2.7)        // 2
     * floor(2.7, true)  // 2.0
     * floor(-2.7)       // -3
     */
    export function floor(x: number, output_type?: boolean): number;

    /** Return the greater of `x` and `y`, as double. */
    export function fmax(x: number, y: number): number;

    /** Return the lesser of `x` and `y`, as double. */
    export function fmin(x: number, y: number): number;

    /**
     * Calculate `sqrt(x^2 + y^2)` without undue overflow or underflow.
     *
     * @example
     * hypot(3, 3)  // 4.2426406871193
     */
    export function hypot(x: number, y: number): number;

    /** Test whether `x` is a double with an infinite value (>= 1.8e308). */
    export function isinf(x: number): boolean;

    /**
     * Test whether `x` is a NaN double. Equivalent to `x !== x`.
     */
    export function isnan(x: number): boolean;

    /** Calculate the natural logarithm of `x`. */
    export function log(x: number): number;

    /**
     * Calculate the base-10 logarithm of `x`.
     *
     * @example
     * log10(100)  // 2.0
     */
    export function log10(x: number): number;

    /**
     * Calculate the natural logarithm of `1 + x`. More precise than
     * `log(1 + x)` for `x` close to zero.
     */
    export function log1p(x: number): number;

    /**
     * Calculate the base-2 logarithm of `x`.
     *
     * @example
     * log2(1024)  // 10.0
     */
    export function log2(x: number): number;

    /**
     * Calculate `x` raised to the power of `y`.
     *
     * @example
     * pow(2, 5)  // 32
     */
    export function pow(x: number, y: number): number;

    /**
     * Convert radians to degrees.
     *
     * @example
     * rad2deg(3.1415926535898)  // 180.0
     */
    export function rad2deg(x: number): number;

    /**
     * Produce a pseudo-random number.
     *
     * - Without arguments: an integer in the range 0..RAND_MAX (at least
     *   32767).
     * - With `a`: a number in the range 0..a (inclusive).
     * - With `a` and `b`: a number in the range a..b (inclusive).
     *
     * The generator is seeded with the current time on first use unless
     * `srand()` was called.
     */
    export function rand(a?: number, b?: number): number;

    /**
     * Return the integral value nearest to `x`, rounding half-way cases away
     * from zero.
     *
     * @param output_type `true` to return a double, integer otherwise.
     * @example
     * round(2.5)   // 3
     * round(-2.5)  // -3
     */
    export function round(x: number, output_type?: boolean): number;

    /**
     * Return `-1`, `0` or `1` depending on the sign of `x`.
     *
     * @example
     * sign(-8)  // -1
     * sign(0)   // 0
     */
    export function sign(x: number): number;

    /**
     * Return `-1`, `0` or `1` depending on the sign of `x`, with IEEE-754
     * behaviour (`-0.0` yields `-1`).
     */
    export function signbit(x: number): number;

    /**
     * Return `-1` or `1` depending on the sign of `x`, zero counts as
     * positive.
     */
    export function signnz(x: number): number;

    /** Calculate the sine of `x`, given in radians. */
    export function sin(x: number): number;

    /** Calculate the hyperbolic sine of `x`. */
    export function sinh(x: number): number;

    /** Calculate the non-negative square root of `x`. */
    export function sqrt(x: number): number;

    /**
     * Seed the pseudo-random number generator used by `rand()`. The same
     * seed produces the same sequence.
     */
    export function srand(seed: number): void;

    /** Calculate the tangent of `x`, given in radians. */
    export function tan(x: number): number;

    /** Calculate the hyperbolic tangent of `x`. */
    export function tanh(x: number): number;

    /**
     * Truncate the decimal portion of `x`.
     *
     * @param output_type `true` to return a double, integer otherwise.
     * @example
     * trunc(2.7)   // 2
     * trunc(-2.7)  // -2
     */
    export function trunc(x: number, output_type?: boolean): number;
}
