export interface ManifestInput {
  version: string;
  /** Base64 public key from extension-key.json; pins the extension ID. */
  key: string;
}

const icons = {
  16: "icons/icon-16.png",
  32: "icons/icon-32.png",
  48: "icons/icon-48.png",
  128: "icons/icon-128.png",
};

export function createManifest({ version, key }: ManifestInput) {
  return {
    manifest_version: 3,
    name: "Mail Counter",
    description: "Unread counts for several Gmail accounts, via the Gmail API.",
    version,
    key,
    icons,
    action: {
      default_title: "Mail Counter",
      default_popup: "popup.html",
      default_icon: { 16: icons[16], 32: icons[32] },
    },
    background: { service_worker: "background.js", type: "module" },
    // No host permissions: Google's APIs allow CORS, and the OAuth popup
    // is handled by chrome.identity.
    permissions: ["identity", "alarms", "storage"],
  };
}
