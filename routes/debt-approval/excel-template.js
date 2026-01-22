// routes/debt-approval/excel-template.js
// Excel shablon yuklab olish

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../../utils/logger.js');

const log = createLogger('EXCEL_TEMPLATE');

/**
 * Excel shablon yuklab olish
 */
router.get('/', async (req, res) => {
    try {
        // Excel shablon yaratish
        const workbook = XLSX.utils.book_new();
        const worksheetData = [
            ['ID_klent', 'Klent_name', 'Dolg_sum'],
            ['1', 'Mijoz 1', '-100000'],
            ['2', 'Mijoz 2', '-250000'],
            ['3', 'Mijoz 3', '-150000']
        ];
        
        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Qarzdorlik');
        
        // Temporary file yaratish
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const fileName = `debt_template_${Date.now()}.xlsx`;
        const filePath = path.join(tempDir, fileName);
        
        XLSX.writeFile(workbook, filePath);
        
        // Faylni yuborish
        res.download(filePath, 'debt_template.xlsx', (err) => {
            // Temporary faylni o'chirish
            setTimeout(() => {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }, 10000);
            
            if (err) {
                log.error('Error sending file:', err);
            }
        });
    } catch (error) {
        log.error('Error creating Excel template:', error);
        res.status(500).json({ success: false, message: 'Xatolik yuz berdi' });
    }
});

module.exports = router;

