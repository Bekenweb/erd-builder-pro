export function isFileCreator(item: any, userId?: string | null, isGuest = false): boolean {
  if (isGuest) return true;
  const ownerId = item?.user_id ?? item?.userId;
  return Boolean(ownerId && userId && String(ownerId) === String(userId));
}

/** True only when the file is known to belong to someone else: such a file opens read-only (DATA-004). */
export function isFileViewer(item: any, userId?: string | null, isGuest = false): boolean {
  if (isGuest) return false;
  const ownerId = item?.user_id ?? item?.userId;
  return Boolean(ownerId && userId && String(ownerId) !== String(userId));
}
