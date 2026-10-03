import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Admins } from './collections/Admins'
import { CatalogAttributeDefinitions } from './collections/CatalogAttributeDefinitions'
import { CatalogAttributeOptions } from './collections/CatalogAttributeOptions'
import { CartItems } from './collections/CartItems'
import { Carts } from './collections/Carts'
import { Categories } from './collections/Categories'
import { Coupons } from './collections/Coupons'
import { CouponRedemptions } from './collections/CouponRedemptions'
import { CuratedCollections } from './collections/CuratedCollections'
import { CustomerAddresses } from './collections/CustomerAddresses'
import { Customers } from './collections/Customers'
import { Inventory } from './collections/Inventory'
import { InventoryMovements } from './collections/InventoryMovements'
import { InventoryReservations } from './collections/InventoryReservations'
import { Media } from './collections/Media'
import { OrderItems } from './collections/OrderItems'
import { Orders } from './collections/Orders'
import { OrderStatusEvents } from './collections/OrderStatusEvents'
import { PaymentAttempts } from './collections/PaymentAttempts'
import { PaymentWebhookEvents } from './collections/PaymentWebhookEvents'
import { Promotions } from './collections/Promotions'
import { Products } from './collections/Products'
import { ProductVariants } from './collections/ProductVariants'
import { WishlistItems } from './collections/WishlistItems'
import { Wishlists } from './collections/Wishlists'
import { addressEndpoints } from './endpoints/addresses'
import { catalogEndpoints } from './endpoints/catalog'
import { cartEndpoints } from './endpoints/cart'
import { commerceEndpoints } from './endpoints/commerce'
import { customerAuthEndpoints } from './endpoints/customer-auth'
import { healthEndpoint } from './endpoints/health'
import { inventoryAdjustmentEndpoint } from './endpoints/inventory'
import { wishlistEndpoints } from './endpoints/wishlist'
import { ShippingSettings } from './globals/ShippingSettings'
import { startMaintenanceLoop } from './jobs/maintenance'
import { withRateLimit } from './lib/rate-limit'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Admins.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [
    Admins,
    Media,
    Categories,
    CuratedCollections,
    CatalogAttributeDefinitions,
    CatalogAttributeOptions,
    Products,
    ProductVariants,
    Inventory,
    InventoryMovements,
    Customers,
    CustomerAddresses,
    Wishlists,
    WishlistItems,
    Carts,
    CartItems,
    Promotions,
    Coupons,
    Orders,
    OrderItems,
    OrderStatusEvents,
    InventoryReservations,
    PaymentAttempts,
    PaymentWebhookEvents,
    CouponRedemptions,
  ],
  globals: [ShippingSettings],
  editor: lexicalEditor(),
  endpoints: [
    healthEndpoint,
    ...catalogEndpoints,
    inventoryAdjustmentEndpoint,
    ...customerAuthEndpoints,
    ...addressEndpoints,
    ...wishlistEndpoints,
    ...cartEndpoints,
    ...commerceEndpoints,
  ].map(withRateLimit),
  // The mobile app uses REST only. Leaving GraphQL on would add an unauthenticated,
  // unthrottled query surface that bypasses the per-route rate limits.
  graphQL: { disable: true },
  onInit: async (payload) => {
    startMaintenanceLoop(payload)
  },
  secret: process.env.PAYLOAD_SECRET || '',
  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    // Schema changes ship only as migrations. Dev auto-sync (push) would create tables without
    // their CHECK constraints and leave migration history out of step with the database.
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
  }),
  sharp,
  plugins: [],
})
