-- 排产预估系统数据库初始化脚本 (PostgreSQL / Supabase)

-- 产品价格信息
CREATE TABLE IF NOT EXISTS product (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100) NOT NULL DEFAULT '',
  name VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NOT NULL DEFAULT '',
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  pack_multiple INT NOT NULL DEFAULT 1,
  unit_type VARCHAR(20) NOT NULL DEFAULT 'batch',
  display_full_quantity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_product_name UNIQUE (name)
);

-- 产品销售策略
CREATE TABLE IF NOT EXISTS product_strategy (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  positioning VARCHAR(20) NOT NULL DEFAULT '其他',
  category VARCHAR(100) NOT NULL DEFAULT '',
  cold_hot VARCHAR(10) NOT NULL DEFAULT '热',
  sales_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
  target_tc DOUBLE PRECISION DEFAULT NULL,
  audience VARCHAR(200) NOT NULL DEFAULT '',
  break_stock_time VARCHAR(20) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 999,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_strategy_product_name UNIQUE (product_name)
);

-- 每日销售记录
CREATE TABLE IF NOT EXISTS daily_sales_record (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  standard_name VARCHAR(200) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  date VARCHAR(10) NOT NULL,
  day_of_week INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dsr_standard_name ON daily_sales_record (standard_name);
CREATE INDEX IF NOT EXISTS idx_dsr_date ON daily_sales_record (date);

-- 产品销售基线（计算结果缓存）
CREATE TABLE IF NOT EXISTS product_sales_baseline (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  avg_monday_to_thursday DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_friday DOUBLE PRECISION NOT NULL DEFAULT 0,
  avg_weekend DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_sales INT NOT NULL DEFAULT 0,
  day_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_baseline_product_name UNIQUE (product_name)
);

-- 产品别名映射
CREATE TABLE IF NOT EXISTS product_alias (
  id SERIAL PRIMARY KEY,
  alias VARCHAR(200) NOT NULL,
  standard_name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_alias UNIQUE (alias)
);
CREATE INDEX IF NOT EXISTS idx_alias_standard_name ON product_alias (standard_name);

-- 业务规则（Key-Value 存储）
CREATE TABLE IF NOT EXISTS business_rule (
  id SERIAL PRIMARY KEY,
  rule_key VARCHAR(100) NOT NULL,
  rule_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_rule_key UNIQUE (rule_key)
);

-- 节假日/特殊日期
CREATE TABLE IF NOT EXISTS holiday (
  id SERIAL PRIMARY KEY,
  date VARCHAR(10) NOT NULL,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL DEFAULT 'public_holiday',
  coefficient DOUBLE PRECISION DEFAULT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_holiday_date UNIQUE (date)
);

-- 固定出货时间表
CREATE TABLE IF NOT EXISTS fixed_shipment_schedule (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  time_slots TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_schedule_product_name UNIQUE (product_name)
);

-- 分时段销售记录（按日期类型分类）
CREATE TABLE IF NOT EXISTS timeslot_sales_record (
  id SERIAL PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  day_type VARCHAR(20) NOT NULL,
  time_slot VARCHAR(10) NOT NULL,
  avg_quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
  sample_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uk_product_daytype_slot UNIQUE (product_name, day_type, time_slot)
);
CREATE INDEX IF NOT EXISTS idx_tsr_day_type ON timeslot_sales_record (day_type);

-- 自动更新 updated_at 的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为所有需要 updated_at 的表创建触发器
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'product', 'product_strategy', 'product_sales_baseline',
    'product_alias', 'business_rule', 'holiday',
    'fixed_shipment_schedule', 'timeslot_sales_record'
  ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I; CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END;
$$;
