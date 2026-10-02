/** True for failures that mean "no connection" rather than a server-side refusal. */
export function isNetworkError(
  error: { message?: string; name?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const text = `${error.name ?? ''} ${error.message ?? ''}`;
  return /network|fetch|timed? ?out|offline/i.test(text);
}
