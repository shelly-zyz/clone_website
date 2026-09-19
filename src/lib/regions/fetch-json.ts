export async function fetchDashboardJson<T>(
  url: string,
  { signal, timeoutMs = 15_000 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) throw new Error(`数据接口返回 ${response.status}`);
  return await response.json() as T;
}
