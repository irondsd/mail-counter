/**
 * Chrome derives an extension's ID from the manifest "key" (a base64 DER
 * SubjectPublicKeyInfo): the first 16 bytes of its SHA-256, written in hex,
 * with the digits 0-f mapped to the letters a-p.
 */
export async function extensionIdFromKey(base64Key: string): Promise<string> {
  const der = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", der));
  let id = "";
  for (const byte of digest.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4), 97 + (byte & 0x0f));
  }
  return id;
}
