export type CreateProviderOrderInput = {
  amountPaise: number
  currency: 'INR'
  receipt: string
}

export type ProviderOrder = {
  amountPaise: number
  currency: 'INR'
  id: string
  status: string
}

export type ProviderPayment = {
  amountPaise: number
  captured: boolean
  currency: string
  id: string
  orderId: string
  status: string
}

export interface PaymentProvider {
  readonly clientKey: string
  readonly name: 'razorpay'
  assertConfigured(): void
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>
  fetchPayment(paymentID: string): Promise<ProviderPayment>
  /** Every payment the gateway holds for one of our gateway orders (used for reconciliation). */
  fetchOrderPayments(providerOrderID: string): Promise<ProviderPayment[]>
  verifyCheckoutSignature(
    providerOrderID: string,
    providerPaymentID: string,
    signature: string,
  ): boolean
  verifyWebhookSignature(rawBody: string, signature: string): boolean
}
