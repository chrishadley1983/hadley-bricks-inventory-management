/**
 * Target constants for the Inventory Health Dashboard.
 * Single source of truth — used by both the service layer and the UI.
 */
export const INVENTORY_HEALTH_TARGETS = {
  LISTED: 1200,
  COG_PCT: 35,
  SELL_THROUGH: 3.6,
  ANNUAL_GROSS: 67500,
  VALUE_COG_RATIO: 2.5,
  INVESTMENT_HOLD_COG_THRESHOLD: 30,
} as const;
