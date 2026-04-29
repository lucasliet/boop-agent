const store = new Map<string, string>();

/**
 * Stores a pending image URL for a conversation. The URL is kept only in
 * process memory — never written to disk or Convex.
 */
export function setPendingImage(conversationId: string, url: string): void {
  store.set(conversationId, url);
}

/**
 * Returns and removes the pending image URL for a conversation, if any.
 */
export function consumePendingImage(conversationId: string): string | undefined {
  const url = store.get(conversationId);
  if (url !== undefined) store.delete(conversationId);
  return url;
}
