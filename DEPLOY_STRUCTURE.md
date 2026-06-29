# Dashboard – Deploy Structure

วางไฟล์ตามโครงสร้างนี้ในโฟลเดอร์ root ของ server:

```
/
├── index.html          ← หน้าหลัก
├── app.js              ← JavaScript logic
├── style.css           ← Styles
├── masterlog.csv       ← Field data (วางที่ root ไม่ใช่ data/)
└── assets/
    ├── chula-logo.png  ← โลโก้ Chula
    ├── ntust-logo.png  ← โลโก้ NTUST
    └── floorplan.png   ← แผนผังชั้น (optional)
```

## การแก้ไขที่ทำ (v4 → v4.1)

| # | ปัญหา | การแก้ไข |
|---|-------|----------|
| 1 | Script `chart.js` และ `chartjs-adapter-date-fns` load ซ้ำ 2 ครั้ง | ลบรายการซ้ำใน `<head>` |
| 2 | `activeSensor()` return `COR_ROOM` สำหรับ Zone B ไม่ match API | แก้เป็น `cor_b_a` format lowercase ทุก zone |
| 3 | `masterlog.csv` fetch จาก `data/masterlog.csv` แต่ไฟล์อยู่ที่ root | แก้ path เป็น `masterlog.csv` |
| 4 | Logo ไม่มี `onerror` fallback ทำให้ broken ถ้า path ผิด | เพิ่ม `onerror` fallback ลองโหลดจาก root ถ้า `assets/` ไม่มี |

## หมายเหตุ Sensor Name

API ใช้ format lowercase เช่น:
- `cor_c_a` = Corridor, Clean Zone
- `cor_r_a` = Corridor, Risk Zone  
- `cor_b_a` = Corridor, Baseline Zone
- `mch_c_a` = MCH, Clean Zone
- `mtg_b_a` = MTG, Baseline Zone

ถ้า API ใช้ format ต่างออกไป ให้แก้ `activeSensor()` ใน `app.js` ตรงๆ
