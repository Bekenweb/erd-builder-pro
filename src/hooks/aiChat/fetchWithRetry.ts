/**
 * Retries an idempotent request (messages carry a client_message_id) on transient failures,
 * e.g. a tunnel 502 after the server already saved the message, or the proxy still persisting
 * the trusted reply after a Plan stream was cut short.
 */
export async function fetchWithRetry(
  send: () => Promise<Response>,
  retryOn: (status: number) => boolean,
  delays: number[] = [800, 2000],
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response | null = null;
    try {
      response = await send();
    } catch (error) {
      if (attempt >= delays.length) throw error;
    }
    if (response && (response.ok || !retryOn(response.status) || attempt >= delays.length)) return response;
    await new Promise(resolve => setTimeout(resolve, delays[attempt]));
  }
}

export const isGatewayError = (status: number) => status >= 502 && status <= 504;
