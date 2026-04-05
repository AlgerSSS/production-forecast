-- 开发计划迁移脚本
-- 计划一：product_strategy 表添加 sort_order 字段
-- 计划三：新增 timeslot_sales_record 表

USE production_forecast;

-- 计划一：添加排序字段
ALTER TABLE product_strategy
  ADD COLUMN sort_order INT NOT NULL DEFAULT 999 COMMENT '策略表中的排列顺序，用于展示排序'
  AFTER break_stock_time;

-- 按现有 id 顺序回填 sort_order
SET @row_number = 0;
UPDATE product_strategy
SET sort_order = (@row_number := @row_number + 1)
ORDER BY id;

-- 计划三：分时段销售记录表
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
