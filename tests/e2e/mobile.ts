/**
 * The mobile app, as far as it matters to the API: the app services, mappers and token store,
 * imported straight from ../mobile/src. A MobileApp behaves like one phone with one signed-in
 * customer; call as() to run app code with that customer session.
 */
import {
  toAddress,
  toCart,
  toCheckoutPreview,
  toOrder,
  toPaymentSession,
  toPlacedOrder,
  toProduct,
  toProfile,
} from '@mobile/src/api/mappers'
import { ApiError } from '@mobile/src/api/errors'
import { addressService } from '@mobile/src/api/services/addresses'
import { authService } from '@mobile/src/api/services/auth'
import { cartService } from '@mobile/src/api/services/cart'
import { catalogService } from '@mobile/src/api/services/catalog'
import { orderService, type CheckoutInput } from '@mobile/src/api/services/orders'
import { wishlistService } from '@mobile/src/api/services/wishlist'
import { tokenStore } from '@mobile/src/api/tokenStore'
import type { AddressInput } from '@mobile/src/types/commerce'

export { ApiError }

export const validAddress: AddressInput = {
  city: 'Jaipur',
  line1: '12 MI Road',
  line2: 'Near Panch Batti',
  phoneNumber: '9876543210',
  pincode: '302001',
  recipientName: 'E2E Customer',
  stateCode: 'RJ',
  type: 'home',
}

export class MobileApp {
  token = ''
  profile?: ReturnType<typeof toProfile>

  constructor(
    readonly email: string,
    readonly password: string,
  ) {}

  /** Same steps as AuthProvider.register and signIn in the app. */
  async register(firstName = 'E2E') {
    await authService.register({ email: this.email, firstName, password: this.password })
    return this.signIn()
  }

  async signIn() {
    const result = await authService.login(this.email, this.password)
    await tokenStore.set(result.token)
    this.token = result.token
    this.profile = toProfile(result.user)
    return this.profile
  }

  /** Run app code as this phone. The token is read synchronously when the request starts. */
  as<T>(run: () => T): T {
    void tokenStore.set(this.token)
    return run()
  }

  // Thin wrappers that apply the same mappers the app hooks apply.
  products = (filters = {}) =>
    this.as(async () => (await catalogService.list(filters)).docs.map(toProduct))
  product = (id: string | number) =>
    this.as(async () => toProduct(await catalogService.get(String(id))))
  cart = () => this.as(async () => toCart(await cartService.get()))
  addToCart = (variantId: number | string, quantity = 1, productId?: number | string) =>
    this.as(async () =>
      toCart(
        await cartService.addItem(
          String(variantId),
          quantity,
          productId === undefined ? undefined : String(productId),
        ),
      ),
    )
  setQuantity = (itemId: string, quantity: number) =>
    this.as(async () => toCart(await cartService.setQuantity(itemId, quantity)))
  removeItem = (itemId: string) => this.as(async () => toCart(await cartService.removeItem(itemId)))
  applyCoupon = (code: string) => this.as(async () => toCart(await cartService.applyCoupon(code)))
  removeCoupon = () => this.as(async () => toCart(await cartService.removeCoupon()))
  addresses = () => this.as(async () => (await addressService.list()).docs.map(toAddress))
  addAddress = (input: AddressInput = validAddress) =>
    this.as(async () => toAddress(await addressService.create(input)))
  updateAddress = (id: string, input: Partial<AddressInput>) =>
    this.as(async () => toAddress(await addressService.update(id, input)))
  removeAddress = (id: string) => this.as(() => addressService.remove(id))
  setDefaultAddress = (id: string) => this.as(() => addressService.setDefault(id))
  wishlistIds = () =>
    this.as(async () => (await wishlistService.list()).docs.map((item) => String(item.productId)))
  wishlistRaw = () => this.as(() => wishlistService.list())
  addToWishlist = (productId: string | number) =>
    this.as(() => wishlistService.add(String(productId)))
  removeFromWishlist = (productId: string | number) =>
    this.as(() => wishlistService.remove(String(productId)))
  preview = (input: CheckoutInput) =>
    this.as(async () => toCheckoutPreview(await orderService.preview(input)))
  placeOrder = (input: CheckoutInput, idempotencyKey: string) =>
    this.as(async () => toPlacedOrder(await orderService.place(input, idempotencyKey)))
  /** Starts an order and returns the raw promise, for concurrency tests. */
  placeOrderNow = (input: CheckoutInput, idempotencyKey: string) =>
    this.as(() => orderService.place(input, idempotencyKey))
  orders = () => this.as(async () => (await orderService.list()).docs.map(toOrder))
  order = (id: string | number) => this.as(async () => toOrder(await orderService.get(String(id))))
  cancelOrder = (id: string) =>
    this.as(async () => toOrder(await orderService.cancel(id, 'Cancelled in e2e')))
  retryPayment = (id: string) =>
    this.as(async () => toPaymentSession(await orderService.retryPayment(id)))
  verifyPayment = (input: Parameters<typeof orderService.verifyPayment>[0]) =>
    this.as(() => orderService.verifyPayment(input))
  updateProfile = (input: Parameters<typeof authService.updateProfile>[0]) =>
    this.as(async () => toProfile(await authService.updateProfile(input)))
  changePassword = (current: string, next: string) =>
    this.as(() => authService.changePassword(current, next))
  logout = () => this.as(() => authService.logout())
  me = () => this.as(() => authService.me())
}

/** Resolve to the ApiError an app call fails with, so tests can assert code and status. */
export const failure = async (call: Promise<unknown>): Promise<ApiError> => {
  try {
    await call
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('Expected the call to fail, but it succeeded.')
}
