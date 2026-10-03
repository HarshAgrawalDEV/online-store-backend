import type { Endpoint, PayloadRequest } from 'payload'

const healthyResponse = {
  service: 'jewelry-backend',
  status: 'healthy',
  success: true,
} as const

const unhealthyResponse = {
  service: 'jewelry-backend',
  status: 'unhealthy',
  success: false,
} as const

export const healthHandler = async (req: PayloadRequest): Promise<Response> => {
  try {
    await req.payload.find({
      collection: 'admins',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      pagination: false,
    })

    return Response.json(healthyResponse, {
      headers: { 'Cache-Control': 'no-store' },
      status: 200,
    })
  } catch {
    req.payload.logger.error('Health check failed because PostgreSQL is unavailable')

    return Response.json(unhealthyResponse, {
      headers: { 'Cache-Control': 'no-store' },
      status: 503,
    })
  }
}

export const healthEndpoint: Endpoint = {
  path: '/health',
  method: 'get',
  handler: healthHandler,
}
