import { createHmac, timingSafeEqual } from 'node:crypto'

import { MobileAPIError } from '../../lib/api-response'
import type {
  CreateProviderOrderInput,
  PaymentProvider,
  ProviderOrder,
  ProviderPayment,
} from './payment-provider'

type RazorpayOrderResponse = { amount: number; currency: string; id: string; status: string }
type RazorpayPaymentResponse = {
  amount: number
  captured: boolean
  currency: string
  id: string
  order_id: string
  status: string
}

const safeEqual = (actual: string, expected: string): boolean => {
  const left = Buffer.from(actual, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay' as const
  readonly clientKey = process.env.RAZORPAY_KEY_ID ?? ''
  private readonly keySecret = process.env.RAZORPAY_KEY_SECRET ?? ''
  private readonly webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? ''

  assertConfigured() {
    if (
      (process.env.PAYMENT_PROVIDER ?? 'razorpay') !== 'razorpay' ||
      !this.clientKey ||
      !this.keySecret
    ) {
      throw new MobileAPIError(
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        'Online payments are not configured.',
        503,
      )
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    this.assertConfigured()
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.clientKey}:${this.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok)
      throw new MobileAPIError('PAYMENT_PROVIDER_ERROR', 'Payment provider request failed.', 502)
    return response.json() as Promise<T>
  }

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    const order = await this.request<RazorpayOrderResponse>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.receipt,
      }),
    })
    return { amountPaise: order.amount, currency: 'INR', id: order.id, status: order.status }
  }

  async fetchPayment(paymentID: string): Promise<ProviderPayment> {
    const payment = await this.request<RazorpayPaymentResponse>(
      `/payments/${encodeURIComponent(paymentID)}`,
    )
    return {
      amountPaise: payment.amount,
      captured: payment.captured,
      currency: payment.currency,
      id: payment.id,
      orderId: payment.order_id,
      status: payment.status,
    }
  }

  async fetchOrderPayments(providerOrderID: string): Promise<ProviderPayment[]> {
    const result = await this.request<{ items?: RazorpayPaymentResponse[] }>(
      `/orders/${encodeURIComponent(providerOrderID)}/payments`,
    )
    return (result.items ?? []).map((payment) => ({
      amountPaise: payment.amount,
      captured: payment.captured,
      currency: payment.currency,
      id: payment.id,
      orderId: payment.order_id,
      status: payment.status,
    }))
  }

  verifyCheckoutSignature(
    providerOrderID: string,
    providerPaymentID: string,
    signature: string,
  ): boolean {
    if (!this.keySecret) return false
    const expected = createHmac('sha256', this.keySecret)
      .update(`${providerOrderID}|${providerPaymentID}`)
      .digest('hex')
    return safeEqual(signature, expected)
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!this.webhookSecret)
      throw new MobileAPIError('WEBHOOK_NOT_CONFIGURED', 'Payment webhook is not configured.', 503)
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex')
    return safeEqual(signature, expected)
  }
}

export const paymentProvider = (): PaymentProvider => new RazorpayProvider()
