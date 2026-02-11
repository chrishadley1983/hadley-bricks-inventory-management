CREATE OR REPLACE VIEW seeded_asin_pricing AS
WITH pricing AS (
  SELECT
    b.set_number,
    b.ean,
    s.asin,
    COALESCE(p.buy_box_price, p.lowest_offer_price, p.competitive_price, p.your_price) AS amazon_price,
    p.was_price_90d,
    b.uk_retail_price,
    b.set_name,
    p.snapshot_date
  FROM seeded_asins s
  JOIN brickset_sets b ON b.id = s.brickset_set_id
  LEFT JOIN amazon_arbitrage_pricing p
    ON p.asin = s.asin
    AND p.snapshot_date = (
      SELECT MAX(p2.snapshot_date)
      FROM amazon_arbitrage_pricing p2
      WHERE p2.asin = s.asin
    )
  WHERE s.asin IS NOT NULL
)
SELECT * FROM pricing
WHERE amazon_price IS NOT NULL
ORDER BY set_number;
