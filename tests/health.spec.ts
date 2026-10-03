import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { healthHandler } from '@/endpoints/health'

const requestWith = (find: ReturnType<typeof vi.fn>): PayloadRequest =>
  ({
    payload: {
      find,
      logger: { error: vi.fn() },
    },
  }) as unknown as PayloadRequest

describe('healthHandler', () => {
  it('reports healthy after a successful database query', async () => {
    const response = await healthHandler(requestWith(vi.fn().mockResolvedValue({ docs: [] })))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      service: 'jewelry-backend',
      status: 'healthy',
      success: true,
    })
  })

  it('reports unhealthy when the database query fails', async () => {
    const response = await healthHandler(
      requestWith(vi.fn().mockRejectedValue(new Error('offline'))),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      service: 'jewelry-backend',
      status: 'unhealthy',
      success: false,
    })
  })
})
