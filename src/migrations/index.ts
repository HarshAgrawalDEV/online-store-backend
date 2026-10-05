import * as migration_20261002_075308_phase_1_initial from './20261002_075308_phase_1_initial';
import * as migration_20261002_092441_phase_2_catalog_inventory from './20261002_092441_phase_2_catalog_inventory';
import * as migration_20261002_101603_phase_3_customer_shopping from './20261002_101603_phase_3_customer_shopping';
import * as migration_20261002_102000_phase_3_invariants from './20261002_102000_phase_3_invariants';
import * as migration_20261003_060603 from './20261003_060603';
import * as migration_20261004_062642_catalog_model from './20261004_062642_catalog_model';
import * as migration_20261004_072339_remove_jewelry_details from './20261004_072339_remove_jewelry_details';
import * as migration_20261004_105124_stock_alerts from './20261004_105124_stock_alerts';
import * as migration_20261004_114820_jewellery_department from './20261004_114820_jewellery_department';
import * as migration_20261004_123311_product_search from './20261004_123311_product_search';

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
  {
    up: migration_20261004_062642_catalog_model.up,
    down: migration_20261004_062642_catalog_model.down,
    name: '20261004_062642_catalog_model',
  },
  {
    up: migration_20261004_072339_remove_jewelry_details.up,
    down: migration_20261004_072339_remove_jewelry_details.down,
    name: '20261004_072339_remove_jewelry_details',
  },
  {
    up: migration_20261004_105124_stock_alerts.up,
    down: migration_20261004_105124_stock_alerts.down,
    name: '20261004_105124_stock_alerts',
  },
  {
    up: migration_20261004_114820_jewellery_department.up,
    down: migration_20261004_114820_jewellery_department.down,
    name: '20261004_114820_jewellery_department',
  },
  {
    up: migration_20261004_123311_product_search.up,
    down: migration_20261004_123311_product_search.down,
    name: '20261004_123311_product_search'
  },
];
