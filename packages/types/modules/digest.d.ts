/**
 * Digest Functions
 *
 * The `digest` module bundles various digest functions. All hashes are
 * returned as lowercase hexadecimal strings.
 *
 * @example
 * import { sha256 } from 'digest';
 * sha256("This is a test");
 *
 * @see https://ucode.mein.io/module-digest.html
 */
declare module "digest" {
    /**
     * Calculate the 64-bit FNV-1a non-cryptographic hash of a string.
     *
     * @example
     * fnv1a64("This is a test")  // "25f0b040ca8b4ce0"
     */
    export function fnv1a64(str: string): string;

    /** Calculate the 64-bit FNV-1a hash of a file, or `null` on error. */
    export function fnv1a64_file(path: string): string | null;

    /**
     * Calculate the MD2 hash of a string.
     *
     * @example
     * md2("This is a test")  // "dc378580fd0722e56b82666a6994c718"
     */
    export function md2(str: string): string;

    /** Calculate the MD2 hash of a file, or `null` on error. */
    export function md2_file(path: string): string | null;

    /**
     * Calculate the MD4 hash of a string.
     *
     * @example
     * md4("This is a test")  // "3b487cf6856af7e330bc4b1b7d977ef8"
     */
    export function md4(str: string): string;

    /** Calculate the MD4 hash of a file, or `null` on error. */
    export function md4_file(path: string): string | null;

    /**
     * Calculate the MD5 hash of a string.
     *
     * @example
     * md5("This is a test")  // "ce114e4501d2f4e2dcea3e17b546f339"
     */
    export function md5(str: string): string;

    /** Calculate the MD5 hash of a file, or `null` on error. */
    export function md5_file(path: string): string | null;

    /**
     * Calculate the SHA1 hash of a string.
     *
     * @example
     * sha1("This is a test")  // "a54d88e06612d820bc3be72877c74f257b561b19"
     */
    export function sha1(str: string): string;

    /** Calculate the SHA1 hash of a file, or `null` on error. */
    export function sha1_file(path: string): string | null;

    /**
     * Calculate the SHA256 hash of a string.
     *
     * @example
     * sha256("This is a test")
     * // "c7be1ed902fb8dd4d48997c6452f5d7e509fbcdbe2808b16bcf4edce4c07d14e"
     */
    export function sha256(str: string): string;

    /** Calculate the SHA256 hash of a file, or `null` on error. */
    export function sha256_file(path: string): string | null;

    /** Calculate the SHA384 hash of a string. */
    export function sha384(str: string): string;

    /** Calculate the SHA384 hash of a file, or `null` on error. */
    export function sha384_file(path: string): string | null;

    /** Calculate the SHA512 hash of a string. */
    export function sha512(str: string): string;

    /** Calculate the SHA512 hash of a file, or `null` on error. */
    export function sha512_file(path: string): string | null;
}
