export declare const API_PREFIX: '/api/v1';

export type ApiUrlResult = { ok: true; url: string } | { ok: false; error: string };

export declare function parseApiBaseUrl(raw: unknown, options?: { production?: boolean }): ApiUrlResult;

export declare function isLocalHost(host: string): boolean;
