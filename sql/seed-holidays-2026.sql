-- 2026年马来西亚公共假期 (吉隆坡/联邦直辖区)
-- 系数由 AI 根据节日类型、节前节后影响动态判断，不在此固定

INSERT INTO holiday (date, name, type, note) VALUES
  ('2026-01-01', '元旦新年', 'public_holiday', '新年公共假期'),
  ('2026-02-01', '大宝森节 / 联邦直辖区日', 'public_holiday', '印度教节日 & 联邦直辖区纪念日（同一天）'),
  ('2026-02-17', '农历新年（初一）', 'public_holiday', '华人新年第一天'),
  ('2026-02-18', '农历新年（初二）', 'public_holiday', '华人新年第二天'),
  ('2026-03-07', '可兰经降世日', 'public_holiday', '伊斯兰教节日'),
  ('2026-03-21', '开斋节（第一天）', 'public_holiday', '斋月结束庆祝第一天'),
  ('2026-03-22', '开斋节（第二天）', 'public_holiday', '斋月结束庆祝第二天'),
  ('2026-05-01', '劳动节', 'public_holiday', '国际劳动节'),
  ('2026-05-27', '哈芝节', 'public_holiday', '伊斯兰教朝觐节'),
  ('2026-05-31', '卫塞节', 'public_holiday', '佛教节日'),
  ('2026-06-01', '国家元首华诞', 'public_holiday', '国家元首生日'),
  ('2026-06-17', '回历新年', 'public_holiday', '伊斯兰历新年'),
  ('2026-08-25', '回教先知诞辰', 'public_holiday', '先知穆罕默德诞辰'),
  ('2026-08-31', '国庆日', 'public_holiday', '马来西亚国庆日'),
  ('2026-09-16', '马来西亚日', 'public_holiday', '马来西亚成立纪念日'),
  ('2026-11-08', '屠妖节', 'public_holiday', '印度教排灯节'),
  ('2026-12-11', '州元首华诞', 'public_holiday', '州元首生日'),
  ('2026-12-25', '圣诞节', 'public_holiday', '圣诞节公共假期')
ON CONFLICT (date) DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  coefficient = NULL,
  note = EXCLUDED.note;
