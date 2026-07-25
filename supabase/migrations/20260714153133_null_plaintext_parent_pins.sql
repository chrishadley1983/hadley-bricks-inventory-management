UPDATE practice.families SET parent_pin = NULL WHERE parent_pin IS NOT NULL AND parent_pin_hash IS NOT NULL;;
