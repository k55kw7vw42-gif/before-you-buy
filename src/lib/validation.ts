/** Upload and URL validation shared by the client and the API routes. */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const ALLOWED_IMAGE_EXTENSIONS = ".png,.jpg,.jpeg,.webp,.gif";

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export function isAllowedImageType(type: string): type is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Sniffs the file's magic bytes. A declared Content-Type is attacker-controlled,
 * so the bytes decide what we actually forward to the AI provider.
 */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  const startsWith = (sig: number[], offset = 0) =>
    sig.every((byte, i) => bytes[offset + i] === byte);

  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  return null;
}

export interface UrlValidation {
  ok: boolean;
  url?: URL;
  error?: string;
}

/** Accepts http(s) URLs only, and normalises a bare "example.com" to https. */
export function validateUrl(input: string): UrlValidation {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Enter a link to check." };
  if (raw.length > 2048) return { ok: false, error: "That link is too long to check." };

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: "That does not look like a valid link." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https links can be checked." };
  }
  if (!url.hostname.includes(".") && url.hostname !== "localhost") {
    return { ok: false, error: "That does not look like a valid web address." };
  }
  return { ok: true, url };
}
