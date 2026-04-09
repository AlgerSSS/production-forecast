import { execute } from "../lib/db";

// 断货记录数据
// 时间转换规则: hour <= 11 → +12
// dayType: 周一到周四=mondayToThursday, 周五=friday, 周六日=weekend

interface StockoutEntry {
  date: string;
  dayType: string;
  items: { name: string; time: string }[];
}

const data: StockoutEntry[] = [
  {
    date: "2026-04-02", // Thursday
    dayType: "mondayToThursday",
    items: [
      { name: "惠灵顿", time: "8:35" },
      { name: "蛋挞", time: "9:21" },
      { name: "马卡龙", time: "9:42" },
    ],
  },
  {
    date: "2026-04-03", // Friday
    dayType: "friday",
    items: [
      { name: "马卡龙", time: "9:20" },
      { name: "蛋挞", time: "9:35" },
      { name: "蔓越莓坚果棒", time: "8:40" },
    ],
  },
  {
    date: "2026-04-04", // Saturday
    dayType: "weekend",
    items: [
      { name: "蛋挞", time: "9:23" },
      { name: "马卡龙", time: "9:27" },
    ],
  },
  {
    date: "2026-04-05", // Sunday
    dayType: "weekend",
    items: [
      { name: "马卡龙", time: "8:29" },
    ],
  },
  {
    date: "2026-04-06", // Monday
    dayType: "mondayToThursday",
    items: [
      { name: "蛋挞", time: "9:49" },
      { name: "惠灵顿", time: "8:32" },
      { name: "马卡龙", time: "9:50" },
    ],
  },
  {
    date: "2026-04-08", // Wednesday
    dayType: "mondayToThursday",
    items: [
      { name: "巧克力碱水结", time: "3:30" },
      { name: "抹茶和鸡肉贝果", time: "4:25" },
      { name: "雪顶草莓", time: "6:10" },
      { name: "奥利奥冰贝果", time: "6:30" },
      { name: "蒜香贝果", time: "6:41" },
      { name: "焦糖冰贝果", time: "7:30" },
      { name: "巧克力泡芙", time: "7:40" },
      { name: "开心果拿破仑酥", time: "8:05" },
      { name: "草莓挞", time: "9:00" },
      { name: "草莓可颂", time: "8:05" },
      { name: "马卡龙", time: "9:11" },
      { name: "鸡肉吐司", time: "9:40" },
      { name: "芋泥吐司", time: "9:59" },
      { name: "蛋挞", time: "8:30" },
    ],
  },
];

function convertTime(timeStr: string): string {
  const [h, m] = timeStr.split(":").map(Number);
  const hour = h <= 11 ? h + 12 : h;
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function calculateLossSlots(soldoutTime: string): string[] {
  const [h, m] = soldoutTime.split(":").map(Number);
  const nextSlotHour = h + 1;
  const slots: string[] = [];
  for (let hour = nextSlotHour; hour <= 21; hour++) {
    slots.push(`${String(hour).padStart(2, "0")}:00`);
  }
  return slots;
}

async function main() {
  let total = 0;
  for (const entry of data) {
    for (const item of entry.items) {
      const soldoutTime = convertTime(item.time);
      const soldoutSlot = `${soldoutTime.split(":")[0]}:00`;
      const lossSlots = calculateLossSlots(soldoutTime);

      await execute(
        `INSERT INTO out_of_stock_record (date, product_name, input_name, soldout_time, soldout_slot, day_type, loss_slots, estimated_loss_qty, estimated_loss_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)`,
        [entry.date, item.name, item.name, soldoutTime, soldoutSlot, entry.dayType, lossSlots.join(",")]
      );
      total++;
      console.log(`✓ ${entry.date} ${item.name} ${soldoutTime} (${lossSlots.length} loss slots)`);
    }
  }
  console.log(`\n共插入 ${total} 条断货记录`);
  process.exit(0);
}

main().catch((err) => {
  console.error("插入失败:", err);
  process.exit(1);
});
