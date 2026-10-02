// Is the IRCC page a citation points at still there? Copied in
// services/briefs-service/src/link-check.ts. Services don't share code today.
//
// Only a 404 or 410 from the server means the page is gone. From Lambda,
// canada.ca takes 2 to 6.5 seconds to answer, so a timeout, a network error,
// a 403 from bot protection or a 5xx says nothing about the page. Calling
// those "moved" put a false "Page moved" badge on every event and a false
// "page has moved" label in brief emails.

export const LINK_CHECK_TIMEOUT_MS = 1_500;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** True only when the server answered that the page doesn't exist. */
export async function sourceIsGone(url: string, fetchImpl: Fetch = fetch, timeoutMs = LINK_CHECK_TIMEOUT_MS): Promise<boolean> {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // GET with a small Range instead of HEAD. canada.ca soft-serves HEAD with
    // a 302 and reports 2xx even when the page 404s.
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Argus/0.1 (link-check)',
        Range: 'bytes=0-127',
      },
    });
    try {
      await res.body?.cancel();
    } catch {
      // ignore cancel errors, we only care about the status
    }
    return res.status === 404 || res.status === 410;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
