import * as migration_20261002_075308_phase_1_initial from './20261002_075308_phase_1_initial'
import * as migration_20261002_092441_phase_2_catalog_inventory from './20261002_092441_phase_2_catalog_inventory'
import * as migration_20261002_101603_phase_3_customer_shopping from './20261002_101603_phase_3_customer_shopping'
import * as migration_20261002_102000_phase_3_invariants from './20261002_102000_phase_3_invariants'
import * as migration_20261003_060603 from './20261003_060603'

export const migrations = [
  {
    up: migration_20261002_075308_phase_1_initial.up,
    down: migration_20261002_075308_phase_1_initial.down,
    name: '20261002_075308_phase_1_initial',
  },
  {
    up: migration_20261002_092441_phase_2_catalog_inventory.up,
    down: migration_20261002_092441_phase_2_catalog_inventory.down,
    name: '20261002_092441_phase_2_catalog_inventory',
  },
  {
    up: migration_20261002_101603_phase_3_customer_shopping.up,
    down: migration_20261002_101603_phase_3_customer_shopping.down,
    name: '20261002_101603_phase_3_customer_shopping',
  },
  {
    up: migration_20261002_102000_phase_3_invariants.up,
    down: migration_20261002_102000_phase_3_invariants.down,
    name: '20261002_102000_phase_3_invariants',
  },
  {
    up: migration_20261003_060603.up,
    down: migration_20261003_060603.down,
    name: '20261003_060603',
  },
]
