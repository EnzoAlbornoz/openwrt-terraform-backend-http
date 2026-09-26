/**
 * Zlib bindings
 *
 * The `zlib` module provides single-call and stream-oriented functions for
 * interacting with zlib data.
 *
 * @example
 * import { deflate, inflate } from 'zlib';
 * const compressed = deflate(content, true);
 * const content = inflate(compressed);
 *
 * @see https://ucode.mein.io/module-zlib.html
 */
declare module "zlib" {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    /** A deflate stream initiated by `deflater()` (`zlib.deflate` resource). */
    export interface DeflateStream {
        /**
         * Write a chunk of uncompressed data to the stream.
         *
         * @param flush One of `Z_NO_FLUSH` (default), `Z_SYNC_FLUSH`,
         * `Z_PARTIAL_FLUSH`, `Z_FULL_FLUSH` or `Z_FINISH`. After `Z_FINISH`
         * no more data can be written.
         * @returns `null` on error.
         */
        write(src: string, flush?: number | null): boolean | null;

        /** Read the compressed data buffered so far, or `null` on error. */
        read(): string | null;

        /** Return a description of the last occurred error, or `null`. */
        error(): string | null;
    }

    /** An inflate stream initiated by `inflater()` (`zlib.inflate` resource). */
    export interface InflateStream {
        /**
         * Write a chunk of compressed data to the stream.
         *
         * @param flush One of `Z_NO_FLUSH` (default), `Z_SYNC_FLUSH` or
         * `Z_FINISH`. After `Z_FINISH` no more data can be written.
         * @returns `null` on error.
         */
        write(src: string, flush?: number | null): boolean | null;

        /** Read the decompressed data buffered so far, or `null` on error. */
        read(): string | null;

        /** Return a description of the last occurred error, or `null`. */
        error(): string | null;
    }

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /** Compression level: no compression. */
    export const Z_NO_COMPRESSION: number;
    /** Compression level: fastest compression. */
    export const Z_BEST_SPEED: number;
    /** Compression level: best compression. */
    export const Z_BEST_COMPRESSION: number;
    /** Compression level: default compromise between speed and compression (level 6). */
    export const Z_DEFAULT_COMPRESSION: number;

    /** Flush mode: no flush (default). */
    export const Z_NO_FLUSH: number;
    /** Flush mode: partial flush. */
    export const Z_PARTIAL_FLUSH: number;
    /** Flush mode: sync flush. */
    export const Z_SYNC_FLUSH: number;
    /** Flush mode: full flush. */
    export const Z_FULL_FLUSH: number;
    /** Flush mode: finish the stream, no more data can be written afterwards. */
    export const Z_FINISH: number;

    // -----------------------------------------------------------------------
    // Functions
    // -----------------------------------------------------------------------

    /**
     * Compress data in zlib or gzip format.
     *
     * When given an object or resource, its `read()` method is called
     * repeatedly to incrementally compress chunks until it returns `null` or
     * an empty string. Throws on errors.
     *
     * @param gzip Add a gzip header, defaults to `false` (zlib format).
     * @param level Compression level 0..9, defaults to
     * `Z_DEFAULT_COMPRESSION`.
     * @example
     * deflate(content);
     * deflate(content, true, Z_BEST_SPEED);
     */
    export function deflate(
        str_or_resource: string | UcodeReadable,
        gzip?: boolean | null,
        level?: number | null,
    ): string;

    /**
     * Initialize a deflate stream, or return `null` on error.
     *
     * @param gzip Add a gzip header, defaults to `false` (zlib format).
     * @param level Compression level 0..9, defaults to
     * `Z_DEFAULT_COMPRESSION`.
     * @example
     * const zstrmd = deflater(true, Z_BEST_SPEED);
     * zstrmd.write(data, Z_FINISH);
     * const compressed = zstrmd.read();
     */
    export function deflater(gzip?: boolean | null, level?: number | null): DeflateStream | null;

    /**
     * Decompress data in zlib or gzip format.
     *
     * When given an object or resource, its `read()` method is called
     * repeatedly to incrementally decompress chunks until it returns `null`
     * or an empty string. Throws on errors.
     */
    export function inflate(str_or_resource: string | UcodeReadable): string;

    /**
     * Initialize an inflate stream accepting zlib or gzip data, or return
     * `null` on error.
     *
     * @example
     * const zstrmi = inflater();
     * zstrmi.write(data, Z_SYNC_FLUSH);
     * const content = zstrmi.read();
     */
    export function inflater(): InflateStream | null;
}
