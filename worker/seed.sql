-- Local seed data. INSERT OR IGNORE so re-runs are no-ops.
INSERT OR IGNORE INTO categories (id, name, slug) VALUES
  ('c_apparel', 'Apparel', 'apparel');

INSERT OR IGNORE INTO products (id, title, slug, description, status) VALUES
  ('p_tee_01', 'Classic Tee', 'classic-tee', 'Heavyweight cotton tee.', 'active'),
  ('p_mug_01', 'Ceramic Mug', 'ceramic-mug', '350ml stoneware mug.', 'active'),
  ('p_cap_01', 'Dad Cap', 'dad-cap', 'Unstructured six-panel cap.', 'draft');

INSERT OR IGNORE INTO product_categories (product_id, category_id) VALUES
  ('p_tee_01', 'c_apparel');

INSERT OR IGNORE INTO product_variants (id, product_id, sku, options) VALUES
  ('v_tee_s', 'p_tee_01', 'TEE-S', '{"size":"S"}'),
  ('v_tee_m', 'p_tee_01', 'TEE-M', '{"size":"M"}'),
  ('v_mug_w', 'p_mug_01', 'MUG-W', '{"color":"white"}'),
  ('v_cap_blk', 'p_cap_01', 'CAP-BLK', '{"color":"black"}');

INSERT OR IGNORE INTO prices (id, variant_id, currency, amount) VALUES
  ('pr_tee_s_usd', 'v_tee_s', 'usd', 2500),
  ('pr_tee_m_usd', 'v_tee_m', 'usd', 2500),
  ('pr_mug_w_usd', 'v_mug_w', 'usd', 1800),
  ('pr_cap_blk_usd', 'v_cap_blk', 'usd', 3200);

INSERT OR IGNORE INTO inventory (variant_id, available) VALUES
  ('v_tee_s', 100),
  ('v_tee_m', 100),
  ('v_mug_w', 50),
  ('v_cap_blk', 25);

INSERT OR IGNORE INTO outbox (id, event_type, payload) VALUES
  ('ob_seed_01', 'catalog.seeded', '{"products":3}');
