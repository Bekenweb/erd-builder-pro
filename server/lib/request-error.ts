/** A refusal the client should see as 4xx; `handleError` answers with this status instead of a generic 500. */
export class RequestError extends Error {
  constructor(readonly status: 400 | 404, message: string) {
    super(message);
  }
}
