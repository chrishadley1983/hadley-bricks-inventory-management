-- Allow 'quickfile' in platform_credentials.platform. The QuickFile MTD export
-- stores its API credentials here; the original constraint predates it and
-- silently blocked every credential save.
ALTER TABLE platform_credentials DROP CONSTRAINT chk_platform_credentials_platform;
ALTER TABLE platform_credentials ADD CONSTRAINT chk_platform_credentials_platform
  CHECK (platform = ANY (ARRAY['amazon'::text, 'ebay'::text, 'bricklink'::text, 'brickowl'::text, 'bricqer'::text, 'ebay-terapeak'::text, 'quickfile'::text]));;
