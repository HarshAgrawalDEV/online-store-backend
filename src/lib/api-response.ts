import { headersWithCors, type PayloadRequest } from 'payload'

export class MobileAPIError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

const responseHeaders = (req: PayloadRequest): Headers =>
  headersWithCors({ headers: new Headers({ 'Cache-Control': 'no-store' }), req })

export const apiSuccess = (
  req: PayloadRequest,
  data: unknown,
  message = 'Operation successful.',
  status = 200,
): Response =>
  Response.json({ success: true, data, message }, { status, headers: responseHeaders(req) })

export const apiError = (
  req: PayloadRequest,
  code: string,
  message: string,
  status: number,
): Response =>
  Response.json(
    { success: false, error: { code, message } },
    { status, headers: responseHeaders(req) },
  )

export const handleAPIError = (
  req: PayloadRequest,
  error: unknown,
  fallbackMessage: string,
): Response => {
  if (error instanceof MobileAPIError) {
    return apiError(req, error.code, error.message, error.status)
  }
  // req.json() throws SyntaxError for a malformed body: a client mistake, not a server fault.
  if (error instanceof SyntaxError) {
    return apiError(req, 'INVALID_JSON', 'Request body must be valid JSON.', 400)
  }
  if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
    const candidate = error as { message: string; status: number }
    if (candidate.status === 401)
      return apiError(req, 'AUTHENTICATION_REQUIRED', candidate.message, 401)
  }
  req.payload.logger.error({ err: error, msg: fallbackMessage })
  return apiError(req, 'INTERNAL_ERROR', fallbackMessage, 500)
}
