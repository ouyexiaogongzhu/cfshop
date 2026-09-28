-- Product primary image stored as R2 object key under MEDIA bucket.
ALTER TABLE products ADD COLUMN image_key TEXT;
