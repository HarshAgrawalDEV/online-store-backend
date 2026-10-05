import 'dotenv/config'

import { getPayload } from 'payload'

import config from '../payload.config'
import { reindexAll } from '../services/search/indexer'

/** Rebuilds the product search index from the catalogue. Safe to run at any time. */
const main = async () => {
  const payload = await getPayload({ config })
  const result = await reindexAll(payload)
  payload.logger.info({ ...result, msg: 'Search index rebuilt' })
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
