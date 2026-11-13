/**
 * Offscreen document: service workers can't play audio, so the background opens this hidden
 * page and asks it to chime.
 */
import { playChime } from "../lib/chime.ts";
import type { OffscreenMessage } from "../lib/types.ts";

chrome.runtime.onMessage.addListener((message: OffscreenMessage, _sender, sendResponse) => {
  // Popup and options messages reach every extension page; only answer our own.
  if (message?.target !== "offscreen") return false;
  playChime(message.volume).then(
    () => sendResponse(true),
    () => sendResponse(false),
  );
  return true;
});
