-- 开发计划迁移脚本 (PostgreSQL)
-- 计划一：product_strategy 表添加 sort_order 字段（已在 init.sql 中包含）
-- 计划三：新增 timeslot_sales_record 表（已在 init.sql 中包含）

-- 如果从旧版本升级，按现有 id 顺序回填 sort_order
UPDATE product_strategy ps
SET sort_order = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM product_strategy
) sub
WHERE ps.id = sub.id;
