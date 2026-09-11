-- تأسیسات آپادانا — توسعه سفارش و مشتری
-- این فایل مرجع توسعه D1 است و برای اجرای مرحله‌ای SQL نگهداری می‌شود.

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  province TEXT NOT NULL,
  city TEXT NOT NULL,
  street TEXT NOT NULL,
  sub_street TEXT NOT NULL,
  alley TEXT NOT NULL,
  plaque TEXT NOT NULL,
  unit TEXT,
  postal_code TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_code TEXT NOT NULL UNIQUE,
  customer_id INTEGER,
  guest_phone TEXT,
  customer_name TEXT NOT NULL,
  province TEXT NOT NULL,
  city TEXT NOT NULL,
  street TEXT NOT NULL,
  sub_street TEXT NOT NULL,
  alley TEXT NOT NULL,
  plaque TEXT NOT NULL,
  unit TEXT,
  postal_code TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  status TEXT NOT NULL DEFAULT 'review',
  postal_tracking_code TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_tracking_code
  ON orders(tracking_code);

CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON orders(customer_id);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
  ON order_status_history(order_id);
