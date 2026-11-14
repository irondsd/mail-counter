/** The toolbar icon's right-click menu, as data the background turns into contextMenus items. */

export const MENU_REFRESH = "refresh";
export const MENU_POPUP = "popup";
export const MENU_MORE = "more";
export const MENU_OPEN_PREFIX = "open:";

/** Chrome shows at most this many top-level items in an action's menu and drops the rest. */
export const TOP_LEVEL_LIMIT = 6;

export interface MenuItem {
  id: string;
  title: string;
  parentId?: string;
}

/**
 * One "Open" item per account, then Refresh, then Open popup. Accounts that would push the
 * last two past Chrome's limit go into an "Open another inbox" submenu instead.
 */
export function menuItems(emails: string[], limit = TOP_LEVEL_LIMIT): MenuItem[] {
  const open = (email: string, parentId?: string): MenuItem => ({
    id: `${MENU_OPEN_PREFIX}${email}`,
    title: `Open ${email}`,
    ...(parentId ? { parentId } : {}),
  });
  const tail: MenuItem[] = [
    ...(emails.length ? [{ id: MENU_REFRESH, title: "Refresh" }] : []),
    { id: MENU_POPUP, title: "Open popup" },
  ];
  const room = limit - tail.length;
  if (emails.length <= room) return [...emails.map((e) => open(e)), ...tail];

  const shown = emails.slice(0, room - 1);
  const rest = emails.slice(room - 1);
  return [
    ...shown.map((e) => open(e)),
    { id: MENU_MORE, title: "Open another inbox" },
    ...rest.map((e) => open(e, MENU_MORE)),
    ...tail,
  ];
}
