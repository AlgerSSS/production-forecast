-- 排产预估系统数据库初始化脚本
-- 使用: mysql -u root -p20010709 < sql/init.sql

CREATE DATABASE IF NOT EXISTS production_forecast
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE production_forecast;

-- 产品价格信息
CREATE TABLE IF NOT EXISTS product (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(100) NOT NULL DEFAULT '',
  name VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) NOT NULL DEFAULT '',
  price DOUBLE NOT NULL DEFAULT 0,
  pack_multiple INT NOT NULL DEFAULT 1,
  unit_type VARCHAR(20) NOT NULL DEFAULT 'batch' COMMENT 'batch=整批, individual=按个',
  display_full_quantity INT NOT NULL DEFAULT 0 COMMENT '满柜数量',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_name (name)
) ENGINE=InnoDB;

-- 产品销售策略
CREATE TABLE IF NOT EXISTS product_strategy (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  positioning VARCHAR(20) NOT NULL DEFAULT '其他' COMMENT 'TOP / 潜在TOP / 其他',
  category VARCHAR(100) NOT NULL DEFAULT '',
  cold_hot VARCHAR(10) NOT NULL DEFAULT '热' COMMENT '冷 / 热',
  sales_ratio DOUBLE NOT NULL DEFAULT 0,
  target_tc DOUBLE DEFAULT NULL,
  audience VARCHAR(200) NOT NULL DEFAULT '',
  break_stock_time VARCHAR(20) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 999 COMMENT '策略表中的排列顺序，用于展示排序',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_product_name (product_name)
) ENGINE=InnoDB;

-- 每日销售记录
CREATE TABLE IF NOT EXISTS daily_sales_record (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  standard_name VARCHAR(200) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  date VARCHAR(10) NOT NULL COMMENT 'YYYY-MM-DD',
  day_of_week INT NOT NULL COMMENT '0=Sunday, 6=Saturday',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_standard_name (standard_name),
  INDEX idx_date (date)
) ENGINE=InnoDB;

-- 产品销售基线（计算结果缓存）
CREATE TABLE IF NOT EXISTS product_sales_baseline (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  avg_monday_to_thursday DOUBLE NOT NULL DEFAULT 0,
  avg_friday DOUBLE NOT NULL DEFAULT 0,
  avg_weekend DOUBLE NOT NULL DEFAULT 0,
  total_sales INT NOT NULL DEFAULT 0,
  day_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_product_name (product_name)
) ENGINE=InnoDB;

-- 产品别名映射
CREATE TABLE IF NOT EXISTS product_alias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  alias VARCHAR(200) NOT NULL,
  standard_name VARCHAR(200) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_alias (alias),
  INDEX idx_standard_name (standard_name)
) ENGINE=InnoDB;

-- 业务规则（Key-Value 存储）
CREATE TABLE IF NOT EXISTS business_rule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rule_key VARCHAR(100) NOT NULL,
  rule_value TEXT NOT NULL COMMENT 'JSON格式的值',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_rule_key (rule_key)
) ENGINE=InnoDB;

-- 节假日/特殊日期
CREATE TABLE IF NOT EXISTS holiday (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date VARCHAR(10) NOT NULL COMMENT 'YYYY-MM-DD',
  name VARCHAR(200) NOT NULL COMMENT '节日名称',
  type VARCHAR(50) NOT NULL DEFAULT 'public_holiday' COMMENT 'public_holiday=法定公假, festival=重要节日, promotion=促销活动, ramadan=斋月, other=其他',
  coefficient DOUBLE DEFAULT NULL COMMENT '该天建议系数（由AI动态判断，可留空）',
  note VARCHAR(500) NOT NULL DEFAULT '' COMMENT '备注说明',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_date (date)
) ENGINE=InnoDB;

-- 固定出货时间表
CREATE TABLE IF NOT EXISTS fixed_shipment_schedule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  time_slots TEXT NOT NULL COMMENT 'JSON数组，如 ["11:00","15:00"]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_product_name (product_name)
) ENGINE=InnoDB;

-- 分时段销售记录（按日期类型分类）
CREATE TABLE IF NOT EXISTS timeslot_sales_record (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  day_type VARCHAR(20) NOT NULL COMMENT 'mondayToThursday / friday / weekend',
  time_slot VARCHAR(10) NOT NULL COMMENT '如 10:00, 11:00',
  avg_quantity DOUBLE NOT NULL DEFAULT 0 COMMENT '该时段平均销量',
  sample_count INT NOT NULL DEFAULT 0 COMMENT '样本天数',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_product_daytype_slot (product_name, day_type, time_slot),
  INDEX idx_day_type (day_type)
) ENGINE=InnoDB;
