# M-OTApp

แอปบันทึกเวรแพทย์บน Windows สำหรับอ่านรูปตารางเวรและรูปผู้ป่วย ตรวจทานข้อมูล แล้วส่งออก Excel รายเดือน แอปใช้ OpenThai OCR Text v2.2.0 อ่านภาษาไทยและอังกฤษบน CPU ในเครื่อง และเลือก Tesseract ได้จากหน้าเพิ่มรูป

## ติดตั้งบน Windows

ใช้ Windows 64 บิต, Node.js 24 และ [uv](https://docs.astral.sh/uv/getting-started/installation/) ที่เรียกได้จาก PowerShell ต้องใช้อินเทอร์เน็ตครั้งแรกเพื่อดาวน์โหลดแพ็กเกจและโมเดล

```powershell
git clone https://github.com/sanchatmd-dev/M-OTApp.git
cd M-OTApp/OT-Desktop
npm ci
.\Install-OpenThai.ps1
npm start
```

เปิด [OT Assistant](http://127.0.0.1:17869/) และเปิดหน้าต่าง PowerShell ที่รัน `npm start` ไว้ระหว่างใช้งาน สคริปต์ติดตั้งเตรียม Python 3.12 ใน `runtime/openthai/` และตรวจ SHA-256 ของไฟล์จาก [OpenThai OCR Text v2.2.0](https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118/tree/v2.2.0)

### ติดตั้ง Tesseract เพิ่มเติม

จากโฟลเดอร์ `OT-Desktop` ดาวน์โหลดชุดภาษาไทยและอังกฤษของ [Tesseract tessdata_best 4.1.0](https://github.com/tesseract-ocr/tessdata_best/tree/4.1.0) จากนั้นเลือก **Tesseract** ในหน้าเพิ่มรูป

```powershell
New-Item -ItemType Directory -Force models | Out-Null
$source = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/4.1.0'
foreach ($file in 'tha.traineddata', 'eng.traineddata', 'LICENSE') {
    Invoke-WebRequest "$source/$file" -OutFile "models/$file"
}
```

## วิธีใช้

1. กรอกข้อมูลแพทย์และชื่อที่ปรากฏในตารางเวร
2. เพิ่มรูปตารางเวร ตรวจเดือน ปี วันที่ และประเภทเวร แล้วกดยืนยัน
3. เพิ่มรูปผู้ป่วย ตรวจวันที่ เวลา AN/HN ชื่อ หอผู้ป่วย และวินิจฉัยเทียบกับภาพ แล้วทำเครื่องหมายตรวจแล้ว
4. แก้วันเวรหรือประเภทเวรของรายการที่อยู่นอกตาราง หรือเอาเครื่องหมายรวมออก แล้วส่งออก Excel

รองรับ JPG, PNG, WebP และ BMP ขนาดไม่เกิน 28 MB ต่อรูป ตารางที่จัดวางต่างจากตัวอย่างและรูปที่อ่านไม่ชัดอาจต้องแก้ด้วยตนเอง

## ข้อมูลในเครื่อง

รูปอยู่ใน `OT-Desktop/data/images/` ข้อมูลที่บันทึกอยู่ใน `OT-Desktop/data/workspace.json` และไฟล์ Excel อยู่ใน `OT-Desktop/exports/` แอปอ่านภาพภายในเครื่อง หลังติดตั้งแล้วทำงานออฟไลน์ได้ ไฟล์สำรอง JSON จากแอปมีรายการและข้อมูลตั้งค่า ส่วนรูปต้องสำรองจากโฟลเดอร์ภาพแยกกัน

## ทดสอบและพัฒนาต่อ

เรียก `npm test` จากโฟลเดอร์ `OT-Desktop` ดูโครงสร้างแอป ข้อกำหนดของ OCR และกติกาการส่งออกใน [context.md](context.md)
