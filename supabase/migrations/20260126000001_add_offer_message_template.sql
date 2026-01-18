-- Migration: Add offer_message_template column to negotiation_config
-- Allows users to configure custom offer messages with placeholder support

ALTER TABLE negotiation_config
ADD COLUMN IF NOT EXISTS offer_message_template TEXT;

-- Add a comment explaining the column
COMMENT ON COLUMN negotiation_config.offer_message_template IS
  'Custom message template for offers. Supports placeholders: {discount}, {title}, {price}, {offer_price}';
