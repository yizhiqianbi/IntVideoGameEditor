-- WeChat VIP checkout records. Membership rows stay in subscription_orders so
-- daily Credit claims keep their existing constraints.
CREATE TABLE guagua_vip_orders (
  subscription_order_id TEXT PRIMARY KEY REFERENCES subscription_orders(id) ON DELETE CASCADE,
  mer_order_tid TEXT NOT NULL UNIQUE CHECK(length(mer_order_tid) BETWEEN 8 AND 30 AND mer_order_tid NOT GLOB '*[^A-Za-z0-9_-]*'),
  merchant_mid TEXT NOT NULL,
  channel_code TEXT NOT NULL,
  pay_url TEXT,
  provider_trade_no TEXT UNIQUE
);
