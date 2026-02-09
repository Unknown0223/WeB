// bot/debt-approval/handlers/debt-excel.js
// "Qarzi bor" Excel jarayoni - Excel shablon yuklab olish, fayl qabul qilish, validatsiya, formatlash, preview

const { createLogger } = require('../../../utils/logger.js');
const { db } = require('../../../db.js');
const { getBot } = require('../../../utils/bot.js');
const stateManager = require('../../unified/stateManager.js');
const userHelper = require('../../unified/userHelper.js');
const { parseExcelFile, formatExcelData, detectColumns, validateAndFilterRows } = require('../../../utils/excelParser.js');
const { sendPreviewToUser, updatePreviewMessage } = require('./preview.js');
const { formatDebtResponseMessage } = require('../../../utils/messageTemplates.js');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const log = createLogger('DEBT_EXCEL');

// FSM states
const STATES = {
    UPLOAD_EXCEL: 'upload_excel',
    UPLOAD_DEBT_EXCEL: 'upload_debt_excel',
    SELECT_COLUMNS: 'select_columns',
    SELECT_SINGLE_COLUMN: 'select_single_column',
    SELECT_COLUMN_VALUE: 'select_column_value',
    CONFIRM_COLUMNS: 'confirm_columns',
    EXCEL_PREVIEW: 'excel_preview',
    CONFIRM_EXCEL: 'confirm_excel'
};

/**
 * Excel shablon yuklab olish
 */
async function sendExcelTemplate(chatId, requestData) {
    try {
        const bot = getBot();
        if (!bot) {
            return;
        }
        
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
        const tempDir = path.join(__dirname, '../../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const fileName = `debt_template_${Date.now()}.xlsx`;
        const filePath = path.join(tempDir, fileName);
        
        XLSX.writeFile(workbook, filePath);
        
        // Faylni yuborish (matn yo'q, faqat fayl)
        const fileStream = fs.createReadStream(filePath);
        await bot.sendDocument(chatId, fileStream);
        
        // Temporary faylni o'chirish
        setTimeout(() => {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }, 60000); // 1 daqiqadan keyin o'chirish
        
        log.debug(`Excel template sent: chatId=${chatId}`);
    } catch (error) {
        log.error('Error sending Excel template:', error);
        throw error;
    }
}

/**
 * Excel fayl qabul qilish
 */
async function handleExcelFile(msg, bot) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl qabul qilish boshlanmoqda: userId=${userId}, chatId=${chatId}`);
        
        const state = stateManager.getUserState(userId);
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] State ma'lumotlari: hasState=${!!state}, context=${state?.context}, state=${state?.state}, requestId=${state?.data?.request_id}`);
        
        if (!state || (state.context !== stateManager.CONTEXTS.DEBT_APPROVAL && state.context !== stateManager.CONTEXTS.HISOBOT)) {
            log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] State topilmadi yoki context mos kelmaydi: hasState=${!!state}, context=${state?.context}`);
            return false;
        }
        
        // Faqat DEBT_APPROVAL context uchun tekshirish (HISOBOT uchun tekshirish yo'q)
        if (state.context === stateManager.CONTEXTS.DEBT_APPROVAL) {
            // SET so'rov uchun Excel fayl faqat set_extra_info state'da qabul qilinadi
            if (state.data?.type === 'SET' && state.state !== 'set_extra_info') {
                // SET so'rov uchun Excel fayl faqat set_extra_info state'da qabul qilinadi
                log.warn(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] ❌ SET so'rov uchun Excel fayl noto'g'ri state'da qabul qilinmoqda: state=${state.state}, userId=${userId}`);
                await bot.sendMessage(chatId, '❌ Excel fayl yuborishdan oldin avval SVR tanlash shart!\n\nIltimos, avval SVR tanlang va keyin Excel fayl yuboring.');
                return true;
            } else if (state.state === STATES.UPLOAD_DEBT_EXCEL) {
                // Qarzi bor uchun UPLOAD_DEBT_EXCEL state
                log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] DEBT_APPROVAL context va UPLOAD_DEBT_EXCEL state: requestId=${state.data?.request_id}, brandId=${state.data?.brand_id}, branchId=${state.data?.branch_id}`);
                
                // Database user_id ni olish (tekshirishlar uchun)
                const user = await userHelper.getUserByTelegram(chatId, userId);
                if (!user) {
                    log.warn(`[DEBT_EXCEL] ❌ Foydalanuvchi topilmadi: userId=${userId}`);
                    await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
                    return true;
                }
                
                // Faqat tegishli foydalanuvchidan qabul qilish
                if (state.data.allowed_user_id) {
                    // Database user_id larni solishtirish
                    if (state.data.allowed_user_id !== user.id) {
                        log.warn(`[DEBT_EXCEL] ❌ Noto'g'ri foydalanuvchi qarzdorlik faylini yubormoqda: telegramUserId=${userId}, databaseUserId=${user.id}, allowedUserId=${state.data.allowed_user_id}, requestId=${state.data.request_id}`);
                        await bot.sendMessage(chatId, '❌ Bu so\'rov sizga tegishli emas. Qarzdorlik faylini faqat tegishli foydalanuvchi yuborishi mumkin.');
                        return true;
                    }
                }
                
                // Filial va brend tekshirish
                if (state.data.branch_id && state.data.brand_id && state.data.request_id) {
                    // So'rovni olish va current_approver_id ni tekshirish
                    const request = await db('debt_requests')
                        .where('id', state.data.request_id)
                        .first();
                    
                    if (request) {
                    // Avval current_approver_type ni tekshirish - agar operator bo'lsa, kassir tekshiruvini o'tkazib yuborish
                    if (request.current_approver_id === user.id && request.current_approver_type === 'operator') {
                        log.info(`[DEBT_EXCEL] ✅ Operator so'rovga tayinlangan (current_approver_id): requestId=${state.data.request_id}, userId=${user.id}`);
                        // Operator tekshiruvi (barcha brendlar bo'yicha ishlaydi agar debt_user_tasks bo'lsa)
                        const operatorTask = await db('debt_user_tasks')
                            .where('user_id', user.id)
                            .where(function() {
                                this.where('task_type', 'approve_operator')
                                    .orWhere('task_type', 'debt:approve_operator');
                            })
                            .first();
                        
                        if (!operatorTask) {
                            // Agar operator vazifasi bo'lmasa, brendlarini tekshirish
                            const [operatorBrandsFromTable, operatorBrandsFromBindings] = await Promise.all([
                                db('debt_operators')
                                    .where('user_id', user.id)
                                    .where('is_active', true)
                                    .pluck('brand_id'),
                                db('debt_user_brands')
                                    .where('user_id', user.id)
                                    .pluck('brand_id')
                            ]);
                            
                            const operatorBrands = [...new Set([...operatorBrandsFromTable, ...operatorBrandsFromBindings])];
                            
                            if (operatorBrands.length > 0 && !operatorBrands.includes(state.data.brand_id)) {
                                log.warn(`[DEBT_EXCEL] ❌ Operator bu brendga tegishli emas: userId=${userId}, brandId=${state.data.brand_id}, operatorBrands=${operatorBrands.join(',')}`);
                                await bot.sendMessage(chatId, '❌ Bu brend sizga tegishli emas. Qarzdorlik faylini faqat tegishli brendga tegishli foydalanuvchi yuborishi mumkin.');
                                return true;
                            }
                        } else {
                            log.info(`[DEBT_EXCEL] Operator vazifasiga ega (taskId=${operatorTask.id}), barcha brendlar bo'yicha ishlaydi`);
                        }
                        // Ruxsat beriladi, keyingi tekshiruvlarni o'tkazib yuborish
                    } else if (request.current_approver_id === user.id && request.current_approver_type === 'cashier') {
                        log.info(`[DEBT_EXCEL] ✅ Kassir so'rovga tayinlangan (current_approver_id): requestId=${state.data.request_id}, userId=${user.id}`);
                        // Ruxsat beriladi, keyingi tekshiruvlarni o'tkazib yuborish
                    } else {
                        // Kassir uchun filial tekshirish (faqat so'rovga tayinlanmagan bo'lsa)
                        if (user.role === 'kassir' || user.role === 'cashier' || userHelper.hasRole(user, ['kassir', 'cashier'])) {
                            const { getCashierBranches } = require('./cashier.js');
                            const cashierBranches = await getCashierBranches(user.id);
                            
                            if (!cashierBranches.includes(state.data.branch_id)) {
                                log.warn(`[DEBT_EXCEL] ❌ Kassir bu filialga tegishli emas: userId=${userId}, databaseUserId=${user.id}, branchId=${state.data.branch_id}, cashierBranches=${cashierBranches.join(',')}`);
                                await bot.sendMessage(chatId, '❌ Bu filial sizga tegishli emas. Qarzdorlik faylini faqat tegishli filialga tegishli foydalanuvchi yuborishi mumkin.');
                                return true;
                            }
                        }
                        
                        // Operator uchun brend tekshirish (faqat current_approver_type operator bo'lmagan bo'lsa)
                        if (userHelper.hasRole(user, ['operator']) || user.role === 'operator') {
                            // Operatorning brendlarini tekshirish
                            const [operatorBrandsFromTable, operatorBrandsFromBindings, operatorTask] = await Promise.all([
                                db('debt_operators')
                                    .where('user_id', user.id)
                                    .where('is_active', true)
                                    .pluck('brand_id'),
                                db('debt_user_brands')
                                    .where('user_id', user.id)
                                    .pluck('brand_id'),
                                db('debt_user_tasks')
                                    .where('user_id', user.id)
                                    .where(function() {
                                        this.where('task_type', 'approve_operator')
                                            .orWhere('task_type', 'debt:approve_operator');
                                    })
                                    .first()
                            ]);
                            
                            let operatorBrands = [...new Set([...operatorBrandsFromTable, ...operatorBrandsFromBindings])];
                            
                            // Agar operator vazifasiga ega bo'lsa (debt_user_tasks), barcha brendlar bo'yicha ishlaydi
                            if (operatorTask) {
                                // Barcha brendlarni olish (cheklovlarsiz)
                                const allBrands = await db('debt_brands').pluck('id');
                                operatorBrands = allBrands;
                                log.info(`[DEBT_EXCEL] Operator vazifasiga ega (taskId=${operatorTask.id}), barcha brendlar bo'yicha ishlaydi: ${allBrands.length} ta brend`);
                            }
                            
                            if (operatorBrands.length > 0 && !operatorBrands.includes(state.data.brand_id)) {
                                log.warn(`[DEBT_EXCEL] ❌ Operator bu brendga tegishli emas: userId=${userId}, brandId=${state.data.brand_id}, operatorBrands=${operatorBrands.join(',')}`);
                                await bot.sendMessage(chatId, '❌ Bu brend sizga tegishli emas. Qarzdorlik faylini faqat tegishli brendga tegishli foydalanuvchi yuborishi mumkin.');
                                return true;
                            }
                        }
                    }
                } else {
                    // So'rov topilmadi, filial tekshirishini o'tkazamiz
                    if (user.role === 'kassir' || user.role === 'cashier' || userHelper.hasRole(user, ['kassir', 'cashier'])) {
                        const { getCashierBranches } = require('./cashier.js');
                        const cashierBranches = await getCashierBranches(user.id);
                        
                        if (!cashierBranches.includes(state.data.branch_id)) {
                            log.warn(`[DEBT_EXCEL] ❌ Kassir bu filialga tegishli emas: userId=${userId}, databaseUserId=${user.id}, branchId=${state.data.branch_id}, cashierBranches=${cashierBranches.join(',')}`);
                            await bot.sendMessage(chatId, '❌ Bu filial sizga tegishli emas. Qarzdorlik faylini faqat tegishli filialga tegishli foydalanuvchi yuborishi mumkin.');
                            return true;
                        }
                    }
                    
                    // Operator uchun brend tekshirish (so'rov topilmagan holatda)
                    if (userHelper.hasRole(user, ['operator']) || user.role === 'operator') {
                        const [operatorBrandsFromTable, operatorBrandsFromBindings, operatorTask] = await Promise.all([
                            db('debt_operators')
                                .where('user_id', user.id)
                                .where('is_active', true)
                                .pluck('brand_id'),
                            db('debt_user_brands')
                                .where('user_id', user.id)
                                .pluck('brand_id'),
                            db('debt_user_tasks')
                                .where('user_id', user.id)
                                .where(function() {
                                    this.where('task_type', 'approve_operator')
                                        .orWhere('task_type', 'debt:approve_operator');
                                })
                                .first()
                        ]);
                        
                        let operatorBrands = [...new Set([...operatorBrandsFromTable, ...operatorBrandsFromBindings])];
                        
                        // Agar operator vazifasiga ega bo'lsa (debt_user_tasks), barcha brendlar bo'yicha ishlaydi
                        if (operatorTask) {
                            const allBrands = await db('debt_brands').pluck('id');
                            operatorBrands = allBrands;
                            log.info(`[DEBT_EXCEL] Operator vazifasiga ega (taskId=${operatorTask.id}), barcha brendlar bo'yicha ishlaydi: ${allBrands.length} ta brend`);
                        }
                        
                        if (operatorBrands.length > 0 && !operatorBrands.includes(state.data.brand_id)) {
                            log.warn(`[DEBT_EXCEL] ❌ Operator bu brendga tegishli emas: userId=${userId}, brandId=${state.data.brand_id}, operatorBrands=${operatorBrands.join(',')}`);
                            await bot.sendMessage(chatId, '❌ Bu brend sizga tegishli emas. Qarzdorlik faylini faqat tegishli brendga tegishli foydalanuvchi yuborishi mumkin.');
                            return true;
                        }
                    }
                }
                }
                
                log.info(`[DEBT_EXCEL] ✅ Foydalanuvchi tekshiruvi o'tdi: userId=${userId}, role=${user.role}, branchId=${state.data.branch_id}, brandId=${state.data.brand_id}`);
            }
        }
        
        // Excel fayl tekshirish
        if (!msg.document) {
            log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Xabarda document yo'q`);
            return false;
        }
        
        const fileId = msg.document.file_id;
        const fileName = msg.document.file_name || 'debt_file.xlsx';
        const fileSize = msg.document.file_size || 0;
        
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl topildi: fileName=${fileName}, fileId=${fileId}, fileSize=${fileSize} bytes, userId=${userId}, requestId=${state.data?.request_id}`);
        
        // Fayl hajmini tekshirish
        const maxFileSize = await getMaxFileSize();
        if (fileSize > maxFileSize * 1024 * 1024) {
            log.warn(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Fayl hajmi juda katta: fileSize=${fileSize} bytes, maxSize=${maxFileSize} MB`);
            await bot.sendMessage(chatId, `❌ Fayl hajmi juda katta. Maksimal hajm: ${maxFileSize} MB`);
            return true;
        }
        
        // Faylni yuklab olish
        const fileInfo = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${fileInfo.file_path}`;
        
        const tempDir = path.join(__dirname, '../../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Fayl nomini tozalash (Windows uchun)
        const cleanFileName = fileName.replace(/[<>:"/\\|?*]/g, '_');
        const filePath = path.join(tempDir, `debt_${userId}_${Date.now()}_${cleanFileName}`);
        
        // Faylni yuklab olish
        const response = await axios({
            method: 'GET',
            url: fileUrl,
            responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        // Excel faylni o'qish - parseExcelFile funksiyasini ishlatish (to'g'ri format)
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel faylni o'qish boshlanmoqda: filePath=${filePath}`);
        
        // Request ma'lumotlarini olish (validatsiya uchun)
        const requestData = await getRequestDataForValidation(state, userId);
        
        // parseExcelFile funksiyasini ishlatish (to'g'ri formatda o'qadi)
        const parseResult = await parseExcelFile(filePath, requestData);
        
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl o'qildi: totalRows=${parseResult.data.length}, filteredRows=${parseResult.filteredData.length}`);
        
        // Excel faylni o'chirish (ma'lumotlar o'qildi, endi fayl kerak emas)
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl o'chirildi: filePath=${filePath}`);
            }
        } catch (unlinkError) {
            log.warn(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel faylni o'chirishda xatolik (keraksiz): filePath=${filePath}, error=${unlinkError.message}`);
        }
        
        if (!parseResult.data || parseResult.data.length === 0) {
            log.warn(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl bo'sh yoki noto'g'ri formatda`);
            await bot.sendMessage(chatId, '❌ Excel fayl bo\'sh yoki noto\'g\'ri formatda.');
            return true;
        }
        
        const headers = parseResult.headers;
        const detectedColumns = parseResult.columns;
        const filteredData = parseResult.filteredData;
        
        // excel_raw_data ni array formatida saqlash (manual ustun tanlash uchun)
        // parseResult.data object formatida, uni array formatiga o'tkazish kerak
        const rawDataAsArrays = parseResult.data.map(row => {
            return headers.map(header => row[header] !== undefined ? row[header] : null);
        });
        
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Headers va qatorlar ajratildi: headersCount=${headers.length}, rowsCount=${parseResult.data.length}, filteredRows=${filteredData.length}`);
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Ustunlar aniqlandi: detectedColumns=${JSON.stringify(detectedColumns)}`);
        
        // SET so'rov uchun tekshirish: agar filtrlangan ma'lumotlar bo'sh bo'lsa yoki summa 0 bo'lsa, NORMAL ga o'zgartirish
        let requestType = state.data.type || 'NORMAL';
        let typeChanged = false;
        
        if (requestType === 'SET' && detectedColumns.id !== null && detectedColumns.name !== null && detectedColumns.summa !== null) {
            const isEmpty = !filteredData || filteredData.length === 0;
            const isZero = parseResult.total === 0 || parseResult.total === null || parseResult.total === undefined;
            
            if (isEmpty || isZero) {
                log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] SET so'rovda qarzdorlik ma'lumotlari topilmadi (filteredRows=${filteredData.length}, total=${parseResult.total}), so'rov turi NORMAL ga o'zgartirilmoqda`);
                requestType = 'NORMAL';
                typeChanged = true;
                
                // Ogohlantirish xabari yuborish
                const branch = state.data.branch_id ? await db('debt_branches').where('id', state.data.branch_id).first() : null;
                const svr = state.data.svr_id ? await db('debt_svrs').where('id', state.data.svr_id).first() : null;
                
                let warningMessage = `⚠️ <b>Ogohlantirish</b>\n\n`;
                warningMessage += `Tanlangan SVR va yuborilgan faylda qarzdorlik ma'lumotlari topilmadi.\n\n`;
                if (branch) warningMessage += `📍 Filial: ${branch.name}\n`;
                if (svr) warningMessage += `👤 SVR: ${svr.name}\n`;
                warningMessage += `\n📋 So'rov turi avtomatik ravishda <b>ODDIY</b> ga o'zgartirildi.\n`;
                warningMessage += `So'rov oddiy so'rov sifatida davom etadi (kassirga yuboriladi).`;
                
                await bot.sendMessage(chatId, warningMessage, { parse_mode: 'HTML' });
            }
        }
        
        // State'ni yangilash (bir nechta marta fayl yuborilganda, eski ma'lumotlar yangilanadi)
        // excel_file_path o'rniga null (fayl saqlanmaydi)
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] State yangilanmoqda: userId=${userId}, requestId=${state.data?.request_id}, type=${requestType}${typeChanged ? ' (o\'zgartirildi)' : ''}`);
        stateManager.updateUserState(userId, state.state, {
            ...state.data,
            type: requestType, // Type'ni yangilash (agar o'zgartirilgan bo'lsa)
            excel_file_path: null, // Fayl saqlanmaydi, faqat ma'lumotlar database'ga saqlanadi
            excel_headers: headers,
            excel_raw_data: rawDataAsArrays, // Array formatida saqlash (manual ustun tanlash uchun)
            excel_columns: detectedColumns,
            excel_detected: detectedColumns,
            excel_data: filteredData, // Filtrlangan ma'lumotlar
            excel_total: parseResult.total, // Jami summa
            last_file_upload_time: Date.now() // Bir nechta marta fayl yuborilganda tracking uchun
        });
        
        // Agar barcha kerakli ustunlar topilgan bo'lsa
        if (detectedColumns.id !== null && detectedColumns.name !== null && detectedColumns.summa !== null) {
            log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Barcha kerakli ustunlar topildi (type=${requestType}, state=${state.state}, requestId=${state.data?.request_id})`);
            
            // ✅ MUHIM: Agar UPLOAD_DEBT_EXCEL state'da va request_id mavjud bo'lsa (qarzi bor holati),
            // preview ko'rsatish kerak (Telegraph link bilan)
            if (state.state === STATES.UPLOAD_DEBT_EXCEL && state.data?.request_id) {
                log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Qarzi bor holati: preview ko'rsatilmoqda: requestId=${state.data.request_id}, userId=${userId}`);
                log.info(`[QARZI_BOR] [DEBT_EXCEL] Excel qabul qilindi (qarzi bor). requestId=${state.data.request_id}, userId=${userId}, qatorlar=${filteredData.length}. Keyingi: Preview ko'rsatiladi, keyin Tasdiqlash/Bekor.`);
                
                // So'rovni olish (solishtirish uchun) - TO'LIQ ma'lumotlar bilan
                const request = await db('debt_requests')
                    .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                    .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                    .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                    .select(
                        'debt_requests.*',
                        'debt_brands.name as brand_name',
                        'debt_branches.name as filial_name',
                        'debt_svrs.name as svr_name'
                    )
                    .where('debt_requests.id', state.data.request_id)
                    .first();
                
                // Solishtirish natijasini olish (agar SET so'rov bo'lsa)
                let comparisonResult = null;
                if (request && request.type === 'SET' && request.excel_data) {
                    try {
                        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Solishtirish boshlanmoqda: requestId=${state.data.request_id}`);
                        
                        const originalExcelData = JSON.parse(request.excel_data);
                        const originalHeaders = request.excel_headers ? JSON.parse(request.excel_headers) : null;
                        const originalColumns = request.excel_columns ? JSON.parse(request.excel_columns) : null;
                        
                        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Original data: ${originalExcelData.length} qator, Headers: ${originalHeaders?.length || 0}, Columns: ${JSON.stringify(originalColumns)}`);
                        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] New data: ${filteredData.length} qator, Headers: ${headers?.length || 0}, Columns: ${JSON.stringify(detectedColumns)}`);
                        
                        // ✅ LOG: Birinchi 3 ta qatorni ko'rsatish
                        if (originalExcelData.length > 0) {
                            log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Original birinchi qator:`, originalExcelData[0]);
                        }
                        if (filteredData.length > 0) {
                            log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] New birinchi qator:`, filteredData[0]);
                        }
                        
                        comparisonResult = compareExcelData(
                            originalExcelData,
                            originalHeaders,
                            originalColumns,
                            filteredData,
                            headers,
                            detectedColumns
                        );
                        
                        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Solishtirish natijasi: isIdentical=${comparisonResult.isIdentical}, differences=${comparisonResult.differences?.length || 0}, totalDifference=${comparisonResult.totalDifference}`);
                        
                        // ✅ LOG: Birinchi 5 ta farqni ko'rsatish
                        if (comparisonResult.differences && comparisonResult.differences.length > 0) {
                            const first5Differences = comparisonResult.differences.slice(0, 5);
                            log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Birinchi 5 ta farq:`, first5Differences.map(diff => ({
                                type: diff.type,
                                id: diff.id,
                                name: diff.name,
                                original_summa: diff.original_summa,
                                new_summa: diff.new_summa,
                                difference: diff.difference
                            })));
                        }
                        
                        // Solishtirish natijasini state'ga saqlash
                        stateManager.updateUserState(userId, state.state, {
                            ...state.data,
                            comparison_result: comparisonResult
                        });
                    } catch (compareError) {
                        log.error(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Solishtirishda xatolik: ${compareError.message}`);
                    }
                }
                
                // Preview ko'rsatish (Telegraph link bilan)
                await showDebtPreviewWithComparison(userId, chatId, bot, stateManager.getUserState(userId), request, comparisonResult);
                
                log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] ✅ Preview ko'rsatildi: requestId=${state.data.request_id}, userId=${userId}`);
                log.info(`[QARZI_BOR] [DEBT_EXCEL] Preview ko'rsatildi (Telegraph link bilan). requestId=${state.data.request_id}. Foydalanuvchi "Tasdiqlash" yoki "Bekor" bosadi.`);
                return true;
            }
            
            // Preview ko'rsatish (faqat yangi so'rov yaratish holatida)
            // Agar type NORMAL ga o'zgartirilgan bo'lsa, SET state'ni NORMAL state'ga o'zgartirish
            if (state.state === 'set_extra_info' && requestType === 'NORMAL') {
                // State'ni PREVIEW ga o'zgartirish (NORMAL so'rov uchun)
                stateManager.updateUserState(userId, 'preview', stateManager.getUserState(userId).data);
                log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] State set_extra_info dan preview ga o'zgartirildi (NORMAL so'rov)`);
            }
            
            // SET so'rov uchun (state.state === 'set_extra_info' va type hali ham SET) showPreview ko'rsatish, aks holda showExcelPreview yoki NORMAL preview
            if (state.state === 'set_extra_info' && requestType === 'SET') {
                log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] SET so'rov uchun showPreview ko'rsatish: userId=${userId}`);
                const { showPreview } = require('./manager.js');
                await showPreview(chatId, userId, null, bot);
            } else if (requestType === 'NORMAL') {
                // NORMAL so'rov uchun preview ko'rsatish
                log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] NORMAL so'rov uchun showPreview ko'rsatish: userId=${userId}`);
                const { showPreview } = require('./manager.js');
                await showPreview(chatId, userId, null, bot);
            } else {
                log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Preview ko'rsatish boshlanmoqda: userId=${userId}, requestId=${state.data?.request_id}`);
                await showExcelPreview(userId, chatId, bot, stateManager.getUserState(userId));
            }
        } else {
            // Manual ustun tanlash
            log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Manual ustun tanlash boshlanmoqda: userId=${userId}, requestId=${state.data?.request_id}`);
            await showColumnSelection(userId, chatId, bot, headers, detectedColumns);
        }
        
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] ✅ Excel fayl muvaffaqiyatli qabul qilindi va qayta ishlandi: userId=${userId}, requestId=${state.data?.request_id}, fileName=${fileName}`);
        return true;
    } catch (error) {
        log.error(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] ❌ Excel faylni qayta ishlashda xatolik: userId=${userId}, requestId=${state?.data?.request_id}, error=${error.message}`, error);
        await bot.sendMessage(chatId, '❌ Excel faylni qayta ishlashda xatolik yuz berdi.');
        return true;
    }
}

/**
 * Request ma'lumotlarini validatsiya uchun olish
 */
async function getRequestDataForValidation(state, userId) {
    try {
        const requestId = state.data.request_id;
        if (requestId) {
            const request = await db('debt_requests')
                .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                .where('debt_requests.id', requestId)
                .select(
                    'debt_brands.name as brand_name',
                    'debt_svrs.name as svr_name'
                )
                .first();
            
            if (request) {
                log.debug(`[VALIDATION] Request data from DB: svr_name="${request.svr_name}", brand_name="${request.brand_name}"`);
            }
            return request || {};
        }
        
        // Agar request_id yo'q bo'lsa, state'dan svr_id va brand_id ni olish va database'dan nomlarini olish
        const requestData = {};
        
        if (state.data.svr_id) {
            const svr = await db('debt_svrs').where('id', state.data.svr_id).select('name').first();
            if (svr) {
                requestData.svr_name = svr.name;
                log.debug(`[VALIDATION] SVR from DB: svr_id=${state.data.svr_id}, svr_name="${svr.name}"`);
            } else {
                log.warn(`[VALIDATION] SVR topilmadi: svr_id=${state.data.svr_id}`);
            }
        } else {
            log.warn(`[VALIDATION] State'da svr_id yo'q`);
        }
        
        if (state.data.brand_id) {
            const brand = await db('debt_brands').where('id', state.data.brand_id).select('name').first();
            if (brand) {
                requestData.brand_name = brand.name;
                log.debug(`[VALIDATION] Brand from DB: brand_id=${state.data.brand_id}, brand_name="${brand.name}"`);
            } else {
                log.warn(`[VALIDATION] Brand topilmadi: brand_id=${state.data.brand_id}`);
            }
        } else {
            log.warn(`[VALIDATION] State'da brand_id yo'q`);
        }
        
        return requestData;
    } catch (error) {
        log.error('Error getting request data for validation:', error);
        return {};
    }
}

/**
 * Ustun tanlash ko'rsatish
 */
async function showColumnSelection(userId, chatId, bot, headers, detectedColumns) {
    try {
        const state = stateManager.getUserState(userId);
        stateManager.updateUserState(userId, STATES.SELECT_COLUMNS, {
            ...state.data
        });
        
        let message = '📋 Excel faylda kerakli ustunlar topilmadi.\n\n';
        message += 'Quyidagi ustunlarni tanlang:\n\n';
        
        const keyboard = {
            inline_keyboard: []
        };
        
        // ID ustuni
        if (detectedColumns.id === null) {
            keyboard.inline_keyboard.push([{ text: '1️⃣ ID ustuni tanlash', callback_data: 'debt_select_column:id' }]);
        }
        
        // Name ustuni
        if (detectedColumns.name === null) {
            keyboard.inline_keyboard.push([{ text: '2️⃣ Ism ustuni tanlash', callback_data: 'debt_select_column:name' }]);
        }
        
        // Summa ustuni
        if (detectedColumns.summa === null) {
            keyboard.inline_keyboard.push([{ text: '3️⃣ Summa ustuni tanlash', callback_data: 'debt_select_column:summa' }]);
        }
        
        // SVR ustuni (ixtiyoriy)
        if (detectedColumns.svr === null) {
            keyboard.inline_keyboard.push([{ text: '4️⃣ SVR ustuni tanlash (ixtiyoriy)', callback_data: 'debt_select_column:svr' }]);
        }
        
        // Brend ustuni (ixtiyoriy)
        if (detectedColumns.brand === null) {
            keyboard.inline_keyboard.push([{ text: '5️⃣ Brend ustuni tanlash (ixtiyoriy)', callback_data: 'debt_select_column:brand' }]);
        }
        
        keyboard.inline_keyboard.push([
            { text: '✅ Tasdiqlash', callback_data: 'debt_confirm_columns' },
            { text: '❌ Bekor qilish', callback_data: 'debt_cancel_excel' }
        ]);
        
        await bot.sendMessage(chatId, message, { reply_markup: keyboard });
    } catch (error) {
        log.error('Error showing column selection:', error);
        throw error;
    }
}

/**
 * Bitta ustun tanlash
 */
async function handleSelectSingleColumn(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const columnType = query.data.split(':')[1];
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || !state.data.excel_headers) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const headers = state.data.excel_headers;
        const keyboard = {
            inline_keyboard: []
        };
        
        headers.forEach((header, index) => {
            if (header) {
                keyboard.inline_keyboard.push([{
                    text: `${index + 1}. ${header}`,
                    callback_data: `debt_select_column_value:${columnType}:${index}`
                }]);
            }
        });
        
        keyboard.inline_keyboard.push([{ text: '❌ Bekor qilish', callback_data: 'debt_cancel_excel' }]);
        
        const columnNames = {
            'id': 'ID',
            'name': 'Ism',
            'summa': 'Summa',
            'svr': 'SVR',
            'brand': 'Brend'
        };
        
        await bot.editMessageText(
            `${columnNames[columnType]} ustunini tanlang:`,
            {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: keyboard
            }
        );
    } catch (error) {
        log.error('Error selecting single column:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Ustun qiymatini tanlash
 */
async function handleSelectColumnValue(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const [, columnType, columnIndex] = query.data.split(':');
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state || !state.data.excel_columns) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const columns = { ...state.data.excel_columns };
        columns[columnType] = parseInt(columnIndex);
        
        stateManager.updateUserState(userId, state.state, {
            ...state.data,
            excel_columns: columns
        });
        
        // Qolgan ustunlarni tekshirish
        if (columns.id !== null && columns.name !== null && columns.summa !== null) {
            // Barcha kerakli ustunlar tanlangan, tasdiqlash
            await handleConfirmColumns(query, bot);
        } else {
            // Yana ustun tanlash
            await showColumnSelection(userId, chatId, bot, state.data.excel_headers, columns);
        }
    } catch (error) {
        log.error('Error selecting column value:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Ustunlarni tasdiqlash
 */
async function handleConfirmColumns(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Tekshirilmoqda...' });
        
        const state = stateManager.getUserState(userId);
        if (!state || !state.data.excel_columns || !state.data.excel_raw_data) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        const columns = state.data.excel_columns;
        const headers = state.data.excel_headers;
        const rawRows = state.data.excel_raw_data;
        
        // Row'larni object formatiga o'tkazish
        const rows = rawRows.map(row => {
            const rowObj = {};
            headers.forEach((header, index) => {
                rowObj[header] = row[index];
            });
            return rowObj;
        });
        
        // Request ma'lumotlarini olish
        const requestData = await getRequestDataForValidation(state, userId);
        
        // Validatsiya va filtrlash
        const validationResult = validateAndFilterRows(rows, columns, requestData, headers);
        
        // State'ni yangilash
        stateManager.updateUserState(userId, STATES.EXCEL_PREVIEW, {
            ...state.data,
            excel_data: validationResult.filtered,
            excel_total: validationResult.filtered.reduce((sum, row) => {
                const summaHeader = headers[columns.summa];
                const summaValue = row[summaHeader];
                const summa = summaValue !== undefined && summaValue !== null
                    ? parseFloat(String(summaValue).replace(/\s/g, '').replace(/,/g, '.'))
                    : 0;
                return sum + (isNaN(summa) ? 0 : summa);
            }, 0)
        });
        
        // Preview ko'rsatish
        await showExcelPreview(userId, chatId, bot, stateManager.getUserState(userId));
    } catch (error) {
        log.error('Error confirming columns:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Qarzi bor holatida preview ko'rsatish (solishtirish bilan)
 */
async function showDebtPreviewWithComparison(userId, chatId, bot, state, request, comparisonResult) {
    try {
        const { excel_data, excel_headers, excel_columns, excel_total, request_id } = state.data;
        
        if (!excel_data || excel_data.length === 0) {
            await bot.sendMessage(chatId, '❌ Excel faylda ma\'lumotlar topilmadi yoki mos kelmadi.');
            return;
        }
        
        // So'rov ma'lumotlarini olish
        // Agar request mavjud bo'lsa, lekin brand_name, filial_name, svr_name yo'q bo'lsa, database'dan qidirish
        let requestData = request;
        if (!requestData || !requestData.brand_name || !requestData.filial_name || !requestData.svr_name) {
            requestData = await db('debt_requests')
                .join('debt_brands', 'debt_requests.brand_id', 'debt_brands.id')
                .join('debt_branches', 'debt_requests.branch_id', 'debt_branches.id')
                .join('debt_svrs', 'debt_requests.svr_id', 'debt_svrs.id')
                .select(
                    'debt_requests.*',
                    'debt_brands.name as brand_name',
                    'debt_branches.name as filial_name',
                    'debt_svrs.name as svr_name'
                )
                .where('debt_requests.id', request_id)
                .first();
        }
        
        if (!requestData) {
            await bot.sendMessage(chatId, '❌ So\'rov topilmadi.');
            return;
        }
        
        // SET so'rov ekanligini aniqlash (Telegraph sahifa yaratishdan oldin)
        const isSetRequest = requestData.type === 'SET';
        
        // Telegraph sahifa yaratish
        // ✅ MUHIM: Agar farq bo'lsa, faqat farqlarni ko'rsatish (ID, nomi, original summa, yangi summa, farq)
        let telegraphUrl = null;
        
        // Agar SET so'rov bo'lsa va farq bo'lsa, farqlar sahifasini yaratish
        if (isSetRequest && comparisonResult && comparisonResult.canCompare && !comparisonResult.isIdentical && comparisonResult.differences && comparisonResult.differences.length > 0) {
            try {
                const { createDifferencesPage } = require('../../../utils/telegraph.js');
                telegraphUrl = await createDifferencesPage({
                    differences: comparisonResult.differences,
                    request_uid: requestData.request_uid,
                    brand_name: requestData.brand_name,
                    filial_name: requestData.filial_name,
                    svr_name: requestData.svr_name,
                    month_name: require('../../../utils/dateHelper.js').getPreviousMonthName()
                });
                log.info(`[DEBT_EXCEL] Farqlar sahifasi yaratildi: ${telegraphUrl}, differencesCount=${comparisonResult.differences.length}`);
            } catch (telegraphError) {
                log.error(`[DEBT_EXCEL] Farqlar sahifasini yaratishda xatolik: ${telegraphError.message}`);
            }
        } else {
            // Oddiy holatda yoki farq bo'lmasa, oddiy qarzdorlik sahifasini yaratish
            try {
                const { createDebtDataPage } = require('../../../utils/telegraph.js');
                telegraphUrl = await createDebtDataPage({
                    request_uid: requestData.request_uid,
                    brand_name: requestData.brand_name,
                    filial_name: requestData.filial_name,
                    svr_name: requestData.svr_name,
                    month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                    extra_info: requestData.extra_info,
                    excel_data: excel_data,
                    excel_headers: excel_headers,
                    excel_columns: excel_columns,
                    total_amount: excel_total
                });
            } catch (telegraphError) {
                log.error(`[DEBT_EXCEL] Telegraph sahifa yaratishda xatolik: ${telegraphError.message}`);
            }
        }
        
        // Xabar matnini tayyorlash
        let messageText = `⚠️ <b>Qarzdorlik ma'lumotlari</b>\n\n`;
        messageText += `So'rov ID: ${requestData.request_uid}\n`;
        messageText += `Brend: ${requestData.brand_name}\n`;
        messageText += `Filial: ${requestData.filial_name}\n`;
        messageText += `SVR: ${requestData.svr_name}\n\n`;
        
        // SET so'rov uchun solishtirish natijasini ko'rsatish
        // isSetRequest allaqachon aniqlangan (yuqorida)
        if (isSetRequest && comparisonResult && comparisonResult.canCompare) {
            if (comparisonResult.isIdentical) {
                messageText += `✅ <b>Ma'lumotlar bir xil</b>\n\n`;
            } else if (comparisonResult.differences && comparisonResult.differences.length > 0) {
                messageText += `⚠️ <b>Farq topildi</b>\n`;
                messageText += `Farqlar soni: ${comparisonResult.differences.length}\n`;
                if (comparisonResult.totalDifference !== undefined) {
                    messageText += `Jami farq: ${comparisonResult.totalDifference.toLocaleString('ru-RU')} so'm\n`;
                }
                messageText += `\n`;
            }
        }
        
        // Telegraph link
        if (telegraphUrl) {
            // Agar farq bo'lsa, "Farqlar" deb ko'rsatish, aks holda "Qarzdorlik klientlar"
            if (isSetRequest && comparisonResult && comparisonResult.canCompare && !comparisonResult.isIdentical && comparisonResult.differences && comparisonResult.differences.length > 0) {
                messageText += `🔗 <a href="${telegraphUrl}">📊 Farqlar:</a>\n`;
            } else {
                messageText += `🔗 <a href="${telegraphUrl}">📊 Qarzdorlik klientlar:</a>\n`;
            }
        } else {
            messageText += `📊 Qarzdorlik klientlar: ${excel_data.length} ta\n`;
        }
        
        if (excel_total !== null && excel_total !== undefined) {
            messageText += `\n💰 TOTAL: ${Math.abs(excel_total).toLocaleString('ru-RU')} so'm`;
        }
        
        // Foydalanuvchi roli va current_approver_type ni aniqlash (knopkalar uchun)
        const userHelper = require('../../unified/userHelper.js');
        const user = await userHelper.getUserByTelegram(chatId, userId);
        let isOperator = false;
        if (requestData.current_approver_type === 'operator' && requestData.current_approver_id === user?.id) {
            isOperator = true;
        } else if (requestData.current_approver_type === 'cashier' && requestData.current_approver_id === user?.id) {
            isOperator = false;
        } else {
            if (user?.role === 'operator') {
                isOperator = true;
            } else {
                const operatorTask = await db('debt_user_tasks')
                    .where('user_id', user?.id)
                    .where(function() {
                        this.where('task_type', 'approve_operator')
                            .orWhere('task_type', 'debt:approve_operator');
                    })
                    .first();
                
                if (operatorTask) {
                    isOperator = true;
                }
            }
        }
        
        // Knopkalar
        let keyboard = { inline_keyboard: [] };
        
        // SET so'rov uchun solishtirish natijasiga qarab knopkalar
        if (isSetRequest && comparisonResult && comparisonResult.canCompare) {
            log.info(`[DEBT_EXCEL] [PREVIEW] Knopkalar uchun tekshiruv: isIdentical=${comparisonResult.isIdentical}, totalDifference=${comparisonResult.totalDifference}, differences=${comparisonResult.differences?.length || 0}`);
            
            if (comparisonResult.isIdentical || (comparisonResult.totalDifference !== undefined && comparisonResult.totalDifference <= 0)) {
                // Bir xil yoki kichik farq → faqat "Tasdiqlash" knopkasi
                const approveCallback = isOperator 
                    ? `operator_approve_${request_id}_${requestData.current_approver_id || user?.id}` 
                    : `cashier_approve_${request_id}`;
                keyboard.inline_keyboard.push([
                    { text: '✅ Tasdiqlash', callback_data: approveCallback }
                ]);
                log.info(`[DEBT_EXCEL] [PREVIEW] ✅ Tasdiqlash knopkasi qo'shildi: callback=${approveCallback}`);
            } else {
                // Katta farq → "Yuborish" va "Bekor qilish" knopkalari
                keyboard.inline_keyboard.push([
                    { text: '✅ Yuborish', callback_data: `debt_confirm_excel_${request_id}` },
                    { text: '❌ Bekor qilish', callback_data: `debt_cancel_excel_${request_id}` }
                ]);
                log.info(`[DEBT_EXCEL] [PREVIEW] ✅ Yuborish va Bekor qilish knopkalari qo'shildi: requestId=${request_id}`);
            }
        } else {
            // ODDIY so'rov yoki solishtirish yo'q → "Yuborish" va "Bekor qilish" knopkalari
            keyboard.inline_keyboard.push([
                { text: '✅ Yuborish', callback_data: `debt_confirm_excel_${request_id}` },
                { text: '❌ Bekor qilish', callback_data: `debt_cancel_excel_${request_id}` }
            ]);
            log.info(`[DEBT_EXCEL] [PREVIEW] ✅ ODDIY so'rov uchun Yuborish va Bekor qilish knopkalari qo'shildi: requestId=${request_id}, isSetRequest=${isSetRequest}, hasComparison=${!!comparisonResult}`);
        }
        
        await bot.sendMessage(chatId, messageText, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
        
        log.info(`[DEBT_EXCEL] Preview ko'rsatildi: requestId=${request_id}, isSetRequest=${isSetRequest}, hasComparison=${!!comparisonResult}`);
    } catch (error) {
        log.error('Error showing debt preview with comparison:', error);
        await bot.sendMessage(chatId, '❌ Preview ko\'rsatishda xatolik yuz berdi.');
    }
}

/**
 * Excel preview ko'rsatish
 */
async function showExcelPreview(userId, chatId, bot, state) {
    try {
        const { excel_data, excel_headers, excel_columns, excel_total, request_id } = state.data;
        
        if (!excel_data || excel_data.length === 0) {
            await bot.sendMessage(chatId, '❌ Excel faylda ma\'lumotlar topilmadi yoki mos kelmadi.');
            return;
        }
        
        // Agar request_id mavjud bo'lsa, darhol solishtirish qilish
        if (request_id) {
            try {
                log.info(`[DEBT_EXCEL] Excel yuklanganda solishtirish boshlanmoqda: requestId=${request_id}`);
                
                const request = await db('debt_requests')
                    .where('id', request_id)
                    .first();
                
                if (request && request.excel_data) {
                    const originalExcelData = JSON.parse(request.excel_data);
                    const originalHeaders = request.excel_headers ? JSON.parse(request.excel_headers) : null;
                    const originalColumns = request.excel_columns ? JSON.parse(request.excel_columns) : null;
                    
                    log.debug(`[DEBT_EXCEL] Original data: ${originalExcelData.length} qator, New data: ${excel_data.length} qator`);
                    
                    // Solishtirish
                    const comparisonResult = compareExcelData(
                        originalExcelData,
                        originalHeaders,
                        originalColumns,
                        excel_data,
                        excel_headers,
                        excel_columns
                    );
                    
                    log.info(`[DEBT_EXCEL] Solishtirish natijasi: isIdentical=${comparisonResult.isIdentical}, differences=${comparisonResult.differences?.length || 0}, canCompare=${comparisonResult.canCompare}`);
                    
                    // Foydalanuvchi roli va current_approver_type ni tekshirish
                    const userHelper = require('../../unified/userHelper.js');
                    const user = await userHelper.getUserByTelegram(chatId, userId);
                    const requestForType = await db('debt_requests').where('id', request_id).first();
                    const isOperator = requestForType && requestForType.current_approver_type === 'operator' && requestForType.current_approver_id === user?.id;
                    
                    // Agar bir xil bo'lsa, preview ko'rsatilmasin va xabar chiqsin
                    if (comparisonResult.isIdentical) {
                        log.info(`[DEBT_EXCEL] ⚠️ Ma'lumotlar bir xil, preview ko'rsatilmaydi, isOperator=${isOperator}`);
                        
                        // Menejerga ham xabar yuborish (web orqali)
                        if (user) {
                            await sendComparisonNotificationToManager(request_id, comparisonResult, user);
                        }
                        
                        // Operator uchun xabar matni boshqacha
                        let messageText;
                        if (isOperator) {
                            messageText = '⚠️ <b>Qardorlik o\'xshash ekanligi aniqlandi</b>\n\n' +
                                'Yuborilgan Excel fayldagi ma\'lumotlar so\'rovdagi ma\'lumotlar bilan bir xil.\n\n' +
                                'Ma\'lumotlar final guruhga yuborilishi mumkin.';
                        } else {
                            messageText = '⚠️ <b>Qardorlik o\'xshash ekanligi aniqlandi</b>\n\n' +
                                'Yuborilgan Excel fayldagi ma\'lumotlar so\'rovdagi ma\'lumotlar bilan bir xil.\n\n' +
                                'Qarzdorlik qabul qilinmaydi va teskari holat bo\'yicha yuborilmaydi.';
                        }
                        
                        // Xabar yuborish va "Tasdiqlash" tugmasi (faqat "Tasdiqlash")
                        const keyboard = {
                            inline_keyboard: [
                                [{ text: '✅ Tasdiqlash', callback_data: `debt_confirm_excel_${request_id}` }]
                            ]
                        };
                        
                        await bot.sendMessage(
                            chatId,
                            messageText,
                            { 
                                parse_mode: 'HTML',
                                reply_markup: keyboard
                            }
                        );
                        
                        log.info(`[DEBT_EXCEL] ✅ Tasdiqlash knopkasi bilan xabar yuborildi: requestId=${request_id}, isOperator=${isOperator}`);
                        
                        // State'ni yangilash - preview ko'rsatilmaydi
                        return;
                    }
                } else {
                    log.debug(`[DEBT_EXCEL] So'rovda Excel ma'lumotlari yo'q, solishtirish o'tkazilmaydi: requestId=${request_id}`);
                }
            } catch (error) {
                log.error('Error comparing Excel data in preview:', error);
                // Xatolik bo'lsa ham preview ko'rsatishda davom etamiz
            }
        }
        
        // Formatlangan ma'lumotlar
        const formattedData = formatExcelData(excel_data, excel_columns, excel_headers, 10);
        
        const message = `📋 Excel ma'lumotlari:\n\n${formattedData}`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Yuborish', callback_data: `debt_confirm_excel_${state.data.request_id || 'new'}` }],
                [{ text: '❌ Bekor qilish', callback_data: 'debt_cancel_excel' }]
            ]
        };
        
        await bot.sendMessage(chatId, message, { reply_markup: keyboard });
    } catch (error) {
        log.error('Error showing Excel preview:', error);
        await bot.sendMessage(chatId, '❌ Preview ko\'rsatishda xatolik yuz berdi.');
    }
}

/**
 * Excel'ni tasdiqlash va yuborish
 */
async function handleConfirmExcel(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const requestId = parseInt(query.data.split('_').pop());
    
    try {
        await bot.answerCallbackQuery(query.id, { text: 'Yuborilmoqda...' });
        
        const state = stateManager.getUserState(userId);
        if (!state || !state.data.excel_data) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        // Foydalanuvchi roli va request_id ni olish
        const userHelper = require('../../unified/userHelper.js');
        const user = await userHelper.getUserByTelegram(chatId, userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Foydalanuvchi topilmadi.');
            return;
        }
        
        const actualRequestId = state.data.request_id || requestId;
        if (!actualRequestId || isNaN(actualRequestId)) {
            await bot.sendMessage(chatId, '❌ So\'rov ID topilmadi.');
            return;
        }
        
        // So'rovdagi Excel ma'lumotlarini olish (solishtirish uchun)
        const request = await db('debt_requests')
            .where('id', actualRequestId)
            .first();
        
        // ✅ MUHIM: SET so'rov uchun solishtirish natijasini state'dan olish (agar mavjud bo'lsa)
        let comparisonResult = null;
        if (request && request.type === 'SET' && state.data.comparison_result) {
            comparisonResult = state.data.comparison_result;
            log.info(`[DEBT_EXCEL] [CONFIRM] State'dan solishtirish natijasi olingan: isIdentical=${comparisonResult.isIdentical}, totalDifference=${comparisonResult.totalDifference}`);
        } else if (request && request.excel_data) {
            // Agar state'da solishtirish natijasi yo'q bo'lsa, yangi solishtirish qilish
            try {
                log.info(`[DEBT_EXCEL] Solishtirish boshlanmoqda: requestId=${actualRequestId}`);
                
                const originalExcelData = JSON.parse(request.excel_data);
                const originalHeaders = request.excel_headers ? JSON.parse(request.excel_headers) : null;
                const originalColumns = request.excel_columns ? JSON.parse(request.excel_columns) : null;
                
                log.debug(`[DEBT_EXCEL] Original data: ${originalExcelData.length} qator, New data: ${state.data.excel_data.length} qator`);
                
                // Solishtirish
                comparisonResult = compareExcelData(
                    originalExcelData,
                    originalHeaders,
                    originalColumns,
                    state.data.excel_data,
                    state.data.excel_headers,
                    state.data.excel_columns
                );
                
                log.info(`[DEBT_EXCEL] Solishtirish natijasi: isIdentical=${comparisonResult.isIdentical}, differences=${comparisonResult.differences?.length || 0}, canCompare=${comparisonResult.canCompare}`);
            } catch (error) {
                log.error('Error comparing Excel data:', error);
            }
        } else {
            log.debug(`[DEBT_EXCEL] So'rovda Excel ma'lumotlari yo'q, solishtirish o'tkazilmaydi: requestId=${actualRequestId}`);
        }
        
        // Excel ma'lumotlarini tayyorlash
        const debtData = {
            debt_details: null,
            total_amount: state.data.excel_total,
            excel_data: state.data.excel_data,
            excel_headers: state.data.excel_headers,
            excel_columns: state.data.excel_columns,
            excel_file_path: state.data.excel_file_path || null,
            image_file_path: null,
            comparison_result: comparisonResult // Solishtirish natijasini qo'shish
        };
        
        // Foydalanuvchi roliga qarab to'g'ri funksiyani chaqirish
        // Avval current_approver_type ni tekshirish (so'rovga tayinlangan rolni aniqlash)
        let isOperator = false;
        let isSupervisor = false;
        if (request && request.current_approver_type === 'operator' && request.current_approver_id === user.id) {
            isOperator = true;
            log.info(`[DEBT_EXCEL] [CONFIRM] So'rovga operator sifatida tayinlangan: requestId=${actualRequestId}, userId=${user.id}`);
        } else if (request && request.current_approver_type === 'supervisor' && request.current_approver_id === user.id) {
            isSupervisor = true;
            isOperator = true; // Supervisor teskari jarayonda operator bilan bir xil (sendDebtResponse)
            log.info(`[DEBT_EXCEL] [CONFIRM] So'rovga supervisor sifatida tayinlangan: requestId=${actualRequestId}, userId=${user.id}`);
        } else if (request && request.current_approver_type === 'cashier' && request.current_approver_id === user.id) {
            isOperator = false;
            log.info(`[DEBT_EXCEL] [CONFIRM] So'rovga kassir sifatida tayinlangan: requestId=${actualRequestId}, userId=${user.id}`);
        } else {
            // current_approver_type bo'lmasa, rolni an'anaviy tarzda aniqlash
            if (user.role === 'operator') {
                isOperator = true;
            } else {
                // debt_user_tasks orqali operator tekshiruvi
                const operatorTask = await db('debt_user_tasks')
                    .where('user_id', user.id)
                    .where(function() {
                        this.where('task_type', 'approve_operator')
                            .orWhere('task_type', 'debt:approve_operator');
                    })
                    .first();
                
                if (operatorTask) {
                    isOperator = true;
                }
            }
        }
        
        // Agar bir xil bo'lsa, tasdiqlash jarayonini davom ettirish (sendDebtResponse emas)
        const isIdentical = comparisonResult && comparisonResult.canCompare && comparisonResult.isIdentical;
        
        if (isIdentical && request && request.type === 'SET') {
            // Bir xil bo'lsa, Excel ma'lumotlarini yangilab, tasdiqlash jarayonini davom ettirish
            log.info(`[DEBT_EXCEL] [CONFIRM] Ma'lumotlar bir xil, Excel ma'lumotlarini yangilab, tasdiqlash jarayonini davom ettirish: requestId=${actualRequestId}`);
            log.info(`[QARZI_BOR] [DEBT_EXCEL] Tasdiqlash bosildi: ma'lumotlar BIR XIL (SET). Tasdiqlash jarayoni (handleOperatorApproval/handleCashierApproval) chaqirildi. requestId=${actualRequestId}, rol=${isOperator ? 'Operator' : 'Kassir'}.`);
            
            // Excel ma'lumotlarini yangilash
            if (debtData.excel_data) {
                await db('debt_requests')
                    .where('id', actualRequestId)
                    .update({
                        excel_data: JSON.stringify(debtData.excel_data),
                        excel_headers: debtData.excel_headers ? JSON.stringify(debtData.excel_headers) : null,
                        excel_columns: debtData.excel_columns ? JSON.stringify(debtData.excel_columns) : null,
                        excel_total: debtData.total_amount
                    });
            }
            
            // Callback_data'ni o'zgartirib, tasdiqlash funksiyasini chaqirish
            if (isOperator) {
                const operatorHandlers = require('./operator.js');
                // Callback query'ni o'zgartirish (operator_approve formatiga)
                const modifiedQuery = {
                    ...query,
                    data: `operator_approve_${actualRequestId}_${request.current_approver_id || user.id}`
                };
                await operatorHandlers.handleOperatorApproval(modifiedQuery, bot);
            } else if (userHelper.hasRole(user, ['kassir', 'cashier']) || (request && request.current_approver_type === 'cashier')) {
                const cashierHandlers = require('./cashier.js');
                // Callback query'ni o'zgartirish (cashier_approve formatiga)
                const modifiedQuery = {
                    ...query,
                    data: `cashier_approve_${actualRequestId}`
                };
                await cashierHandlers.handleCashierApproval(modifiedQuery, bot);
            } else {
                log.warn(`Unknown role for approval: userId=${userId}, role=${user.role}, current_approver_type=${request?.current_approver_type}`);
                await bot.sendMessage(chatId, '❌ Bu funksiya faqat kassir va operatorlar uchun.');
                return;
            }
            
            // State'ni tozalash
            stateManager.clearUserState(userId);
            return;
        }
        
        // Agar farq bo'lsa yoki NORMAL so'rov bo'lsa, sendDebtResponse chaqirish
        const roleLabel = isSupervisor ? 'Supervisor' : (isOperator ? 'Operator' : 'Kassir');
        log.info(`[QARZI_BOR] [DEBT_EXCEL] Tasdiqlash bosildi: farq bor yoki NORMAL so'rov. sendDebtResponse chaqiriladi. requestId=${actualRequestId}, rol=${roleLabel}. Xabarlar Menejer/Rahbarlar/Final ga ketadi.`);
        if (isOperator || isSupervisor) {
            // Operator va Supervisor uchun bir xil teskari jarayon (operator.sendDebtResponse)
            const operatorHandlers = require('./operator.js');
            await operatorHandlers.sendDebtResponse(actualRequestId, userId, chatId, debtData);
        } else if (userHelper.hasRole(user, ['kassir', 'cashier']) || (request && request.current_approver_type === 'cashier')) {
            const cashierHandlers = require('./cashier.js');
            await cashierHandlers.sendDebtResponse(actualRequestId, userId, chatId, debtData);
        } else {
            log.warn(`Unknown role for debt response: userId=${userId}, role=${user.role}, current_approver_type=${request?.current_approver_type}`);
            await bot.sendMessage(chatId, '❌ Bu funksiya faqat kassir, operator va nazoratchilar uchun.');
            return;
        }
        
        // ✅ Farqlar Telegraph link orqali ko'rsatiladi, Telegram xabarida ko'rsatilmaydi
        // Menejerga ham xabar yuborish (web orqali)
        if (comparisonResult && !comparisonResult.isIdentical && comparisonResult.differences.length > 0) {
            await sendComparisonNotificationToManager(actualRequestId, comparisonResult, user);
        }
        
        // Telegraph sahifa yaratish (agar Excel ma'lumotlari mavjud bo'lsa)
        let telegraphUrl = null;
        if (state.data.excel_data && Array.isArray(state.data.excel_data) && state.data.excel_data.length > 0 && state.data.excel_columns) {
            try {
                const { createDebtDataPage } = require('../../../utils/telegraph.js');
                telegraphUrl = await createDebtDataPage({
                    request_uid: state.data.request_uid || `REQ-${actualRequestId}`,
                    brand_name: state.data.brand_name || null,
                    filial_name: state.data.filial_name || null,
                    svr_name: state.data.svr_name || null,
                    month_name: require('../../../utils/dateHelper.js').getPreviousMonthName(),
                    extra_info: null,
                    excel_data: state.data.excel_data,
                    excel_headers: state.data.excel_headers,
                    excel_columns: state.data.excel_columns,
                    total_amount: state.data.excel_total
                });
            } catch (telegraphError) {
                // Telegraph xatolari silent qilinadi (ixtiyoriy xizmat)
                log.debug(`[DEBT_EXCEL] [CONFIRM_EXCEL] Telegraph xatolik (ixtiyoriy xizmat): requestId=${actualRequestId}`);
            }
        }
        
        // Excel ma'lumotlarini formatlash (xabar ko'rsatish uchun)
        const debtMessage = formatDebtResponseMessage({
            request_uid: state.data.request_uid || `REQ-${actualRequestId}`,
            brand_name: state.data.brand_name || null,
            filial_name: state.data.filial_name || null,
            svr_name: state.data.svr_name || null,
            debt_details: null,
            total_amount: state.data.excel_total,
            excel_data: state.data.excel_data,
            excel_headers: state.data.excel_headers,
            excel_columns: state.data.excel_columns,
            telegraph_url: telegraphUrl
        });
        
        // Xabarni tayyorlash - agar bir xil bo'lsa, bir xil ekanligi haqida ma'lumot qo'shish
        let finalMessage = `✅ <b>Qarzdorlik ma'lumotlari yuborildi!</b>\n\n`;
        
        if (comparisonResult && comparisonResult.isIdentical) {
            finalMessage += `⚠️ <b>Eslatma:</b> Yuborilgan ma'lumotlar so'rovdagi ma'lumotlar bilan bir xil.\n\n`;
        } else {
            finalMessage += `⚠️ <b>Qarzdorlik topildi</b>\n`;
        }
        
        finalMessage += `So'rov ID: ${state.data.request_uid || `REQ-${actualRequestId}`}\n\n`;
        finalMessage += debtMessage;
        
        try {
            await bot.editMessageText(
                finalMessage,
                {
                    chat_id: chatId,
                    message_id: query.message.message_id,
                    parse_mode: 'HTML'
                }
            );
        } catch (error) {
            // Agar xabarni yangilab bo'lmasa, yangi xabar yuborish
            log.warn('Could not edit message, sending new message:', error.message);
            await bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML' });
        }
        
        // State'ni tozalash
        stateManager.clearUserState(userId);
        
        log.info(`Debt Excel confirmed and sent: requestId=${actualRequestId}, userId=${userId}, role=${user.role}`);
        
        // Keyingi so'rovni avtomatik ko'rsatish
        if (userHelper.hasRole(user, ['kassir', 'cashier'])) {
            const cashierHandlers = require('./cashier.js');
            await cashierHandlers.showNextCashierRequest(userId, chatId);
        } else if (userHelper.hasRole(user, ['operator'])) {
            const operatorHandlers = require('./operator.js');
            await operatorHandlers.showNextOperatorRequest(userId, chatId);
        }
    } catch (error) {
        log.error('Error confirming Excel:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Excel'ni qayta yuklash
 */
async function handleEditExcel(query, bot) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    
    try {
        await bot.answerCallbackQuery(query.id);
        
        const state = stateManager.getUserState(userId);
        if (!state) {
            await bot.sendMessage(chatId, '❌ Jarayon to\'xtatilgan.');
            return;
        }
        
        stateManager.updateUserState(userId, STATES.UPLOAD_EXCEL, {
            ...state.data,
            excel_file_path: null,
            excel_data: null,
            excel_columns: null
        });
        
        await bot.sendMessage(
            chatId,
            '📎 Excel faylni qayta yuboring yoki shablonni yuklab oling:\n\n' +
            'Shablon yuklab olish uchun /debt_template buyrug\'ini yuboring.'
        );
    } catch (error) {
        log.error('Error editing Excel:', error);
        await bot.sendMessage(chatId, '❌ Xatolik yuz berdi.');
    }
}

/**
 * Excel ma'lumotlarini solishtirish
 */
function compareExcelData(originalData, originalHeaders, originalColumns, newData, newHeaders, newColumns) {
    try {
        // Agar original data yo'q bo'lsa, solishtirish mumkin emas
        if (!originalData || !Array.isArray(originalData) || originalData.length === 0) {
            log.debug('[COMPARE] Original data yo\'q yoki bo\'sh');
            return { isIdentical: false, differences: [], canCompare: false };
        }
        
        if (!newData || !Array.isArray(newData) || newData.length === 0) {
            log.debug('[COMPARE] New data yo\'q yoki bo\'sh');
            return { isIdentical: false, differences: [], canCompare: false };
        }
        
        log.debug(`[COMPARE] Solishtirish: Original=${originalData.length} qator, New=${newData.length} qator`);
        log.debug(`[COMPARE] Original columns:`, originalColumns);
        log.debug(`[COMPARE] New columns:`, newColumns);
        
        // ID va summa bo'yicha solishtirish
        const originalMap = new Map();
        let originalMappedCount = 0;
        originalData.forEach((row, index) => {
            const idKey = getRowId(row, originalHeaders, originalColumns);
            const summa = getRowSumma(row, originalHeaders, originalColumns);
            if (idKey) {
                const name = getRowName(row, originalHeaders, originalColumns);
                originalMap.set(idKey, {
                    id: idKey,
                    name: name,
                    summa: summa
                });
                originalMappedCount++;
                
                // ✅ LOG: Birinchi 5 ta qatorni log qilish
                if (index < 5) {
                    log.info(`[COMPARE] [ORIGINAL] Row ${index + 1}: id=${idKey}, name=${name}, summa=${summa}`);
                }
            } else if (index < 3) {
                log.debug(`[COMPARE] Original row ${index} ID topilmadi, row keys:`, Object.keys(row || {}));
            }
        });
        
        const newMap = new Map();
        let newMappedCount = 0;
        newData.forEach((row, index) => {
            const idKey = getRowId(row, newHeaders, newColumns);
            const summa = getRowSumma(row, newHeaders, newColumns);
            if (idKey) {
                const name = getRowName(row, newHeaders, newColumns);
                newMap.set(idKey, {
                    id: idKey,
                    name: name,
                    summa: summa
                });
                newMappedCount++;
                
                // ✅ LOG: Birinchi 5 ta qatorni log qilish
                if (index < 5) {
                    log.info(`[COMPARE] [NEW] Row ${index + 1}: id=${idKey}, name=${name}, summa=${summa}`);
                }
            } else if (index < 3) {
                log.debug(`[COMPARE] New row ${index} ID topilmadi, row keys:`, Object.keys(row || {}));
            }
        });
        
        log.info(`[COMPARE] Mapped: Original=${originalMappedCount}/${originalData.length}, New=${newMappedCount}/${newData.length}`);
        
        // Farqlarni topish
        const differences = [];
        let totalDifference = 0;
        
        // Yangi yoki o'zgargan qatorlar
        newMap.forEach((newRow, id) => {
            const originalRow = originalMap.get(id);
            if (!originalRow) {
                // Yangi qator
                differences.push({
                    type: 'new',
                    id: id,
                    name: newRow.name,
                    summa: newRow.summa
                });
                totalDifference += Math.abs(newRow.summa || 0);
                
                // ✅ LOG: Yangi qatorlar
                log.debug(`[COMPARE] [NEW] id=${id}, name=${newRow.name}, summa=${newRow.summa}`);
            } else if (Math.abs((originalRow.summa || 0) - (newRow.summa || 0)) > 0.01) {
                // Summa o'zgardi
                const difference = newRow.summa - originalRow.summa;
                differences.push({
                    type: 'changed',
                    id: id,
                    name: newRow.name,
                    original_summa: originalRow.summa,
                    new_summa: newRow.summa,
                    difference: difference
                });
                totalDifference += Math.abs((newRow.summa || 0) - (originalRow.summa || 0));
                
                // ✅ LOG: O'zgargan qatorlar
                log.debug(`[COMPARE] [CHANGED] id=${id}, name=${newRow.name}, original=${originalRow.summa}, new=${newRow.summa}, difference=${difference}`);
            } else {
                // Bir xil - log qilmaymiz
                log.debug(`[COMPARE] [IDENTICAL] id=${id}, name=${newRow.name}, summa=${newRow.summa} (bir xil)`);
            }
        });
        
        // O'chirilgan qatorlar
        originalMap.forEach((originalRow, id) => {
            if (!newMap.has(id)) {
                differences.push({
                    type: 'removed',
                    id: id,
                    name: originalRow.name,
                    summa: originalRow.summa
                });
                totalDifference += Math.abs(originalRow.summa || 0);
            }
        });
        
        // Agar farq yo'q bo'lsa, bir xil
        const isIdentical = differences.length === 0;
        
        // ✅ LOG: Solishtirish natijasi
        log.info(`[COMPARE] Solishtirish yakunlandi: isIdentical=${isIdentical}, differences=${differences.length}, totalDifference=${Math.abs(totalDifference)}`);
        log.info(`[COMPARE] Original count: ${originalData.length}, New count: ${newData.length}, Mapped: Original=${originalMappedCount}, New=${newMappedCount}`);
        
        // ✅ LOG: Farqlar tafsiloti
        if (differences.length > 0) {
            const changedCount = differences.filter(d => d.type === 'changed').length;
            const newCount = differences.filter(d => d.type === 'new').length;
            const removedCount = differences.filter(d => d.type === 'removed').length;
            log.info(`[COMPARE] Farqlar tafsiloti: changed=${changedCount}, new=${newCount}, removed=${removedCount}`);
        }
        
        return {
            isIdentical,
            differences,
            totalDifference: Math.abs(totalDifference),
            originalCount: originalData.length,
            newCount: newData.length,
            canCompare: true
        };
    } catch (error) {
        log.error('Error comparing Excel data:', error);
        return { isIdentical: false, differences: [], canCompare: false, error: error.message };
    }
}

/**
 * Qatordan ID olish
 */
function getRowId(row, headers, columns) {
    if (!columns || columns.id === null || columns.id === undefined) return null;
    if (!headers || !headers[columns.id]) return null;
    const header = headers[columns.id];
    const value = row[header];
    const result = value ? String(value).trim() : null;
    
    // ✅ LOG: ID olish jarayoni
    if (!result) {
        log.debug(`[COMPARE] [GET_ROW_ID] ID topilmadi: header=${header}, value=${value}, row keys:`, Object.keys(row || {}));
    }
    
    return result;
}

/**
 * Qatordan Name olish
 */
function getRowName(row, headers, columns) {
    if (!columns || columns.name === null || columns.name === undefined) return null;
    if (!headers || !headers[columns.name]) return null;
    const header = headers[columns.name];
    const value = row[header];
    return value ? String(value).trim() : null;
}

/**
 * Qatordan Summa olish
 */
function getRowSumma(row, headers, columns) {
    if (!columns || columns.summa === null || columns.summa === undefined) return 0;
    if (!headers || !headers[columns.summa]) return 0;
    const header = headers[columns.summa];
    const value = row[header];
    if (value === null || value === undefined || value === '') return 0;
    const num = parseFloat(String(value).replace(/\s/g, '').replace(/,/g, '.'));
    const result = isNaN(num) ? 0 : num;
    
    // ✅ LOG: Summa olish jarayoni (faqat xatolik bo'lsa)
    if (isNaN(num) && value !== null && value !== undefined && value !== '') {
        log.debug(`[COMPARE] [GET_ROW_SUMMA] Summa parse qilinmadi: header=${header}, value=${value}, row keys:`, Object.keys(row || {}));
    }
    
    return result;
}

/**
 * Farqlarni formatlash
 * ✅ Format: Bitta qatorda barcha ma'lumotlar, faqat kattaroq yoki yangi bo'lganlar
 */
function formatDifferencesMessage(comparisonResult) {
    if (!comparisonResult || !comparisonResult.canCompare) {
        return '';
    }
    
    if (comparisonResult.isIdentical) {
        return '✅ Ma\'lumotlar bir xil';
    }
    
    // ✅ Filtrlash: Faqat kattaroq yoki yangi bo'lganlar
    const filteredDifferences = comparisonResult.differences.filter(diff => {
        if (diff.type === 'new') {
            return true; // Yangilar hammasi ko'rsatiladi
        } else if (diff.type === 'changed') {
            // Faqat agar yangi summa mutlaq qiymat bo'yicha kattaroq bo'lsa
            const originalSumma = Math.abs(diff.original_summa || 0);
            const newSumma = Math.abs(diff.new_summa || 0);
            return newSumma > originalSumma;
        }
        // O'chirilganlar ko'rsatilmaydi
        return false;
    });
    
    // Tartib: avval o'zgarganlar, keyin yangilar
    const changedDiffs = filteredDifferences.filter(diff => diff.type === 'changed');
    const newDiffs = filteredDifferences.filter(diff => diff.type === 'new');
    const sortedDifferences = [...changedDiffs, ...newDiffs];
    
    let message = '📊 <b>Farqlar topildi:</b>\n\n';
    
    if (sortedDifferences.length > 0) {
        // Faqat birinchi 20 ta farqni ko'rsatish (Telegram xabarida)
        const shownDifferences = sortedDifferences.slice(0, 20);
        
        let currentIndex = 0;
        shownDifferences.forEach((diff) => {
            currentIndex++;
            if (diff.type === 'new') {
                // Yangilar: ➕ ID - Nomi || Summa
                const summa = Math.abs(diff.summa || 0);
                message += `${currentIndex}. ➕ ${diff.id || 'N/A'} - ${diff.name || 'N/A'} || ${summa.toLocaleString('ru-RU')}\n`;
            } else if (diff.type === 'changed') {
                // O'zgarganlar: 🔄 ID - Nomi || Menejer summa || Kassir/Operator summa || Farq: farq
                const originalSumma = Math.abs(diff.original_summa || 0);
                const newSumma = Math.abs(diff.new_summa || 0);
                const difference = diff.difference || 0;
                message += `${currentIndex}. 🔄 ${diff.id || 'N/A'} - ${diff.name || 'N/A'} || ${originalSumma.toLocaleString('ru-RU')} || ${newSumma.toLocaleString('ru-RU')} || Farq: ${difference > 0 ? '+' : ''}${difference.toLocaleString('ru-RU')}\n`;
            }
        });
        
        if (sortedDifferences.length > 20) {
            message += `\n... va yana ${sortedDifferences.length - 20} ta farq\n`;
        }
    }
    
    message += `\n💰 <b>Jami farq:</b> ${comparisonResult.totalDifference.toLocaleString('ru-RU')} so'm`;
    message += `\n📊 Original: ${comparisonResult.originalCount} qator, Yangi: ${comparisonResult.newCount} qator`;
    
    return message;
}

/**
 * Menejerga solishtirish xabarini yuborish (web orqali)
 */
async function sendComparisonNotificationToManager(requestId, comparisonResult, user) {
    try {
        const request = await db('debt_requests')
            .where('id', requestId)
            .first();
        
        if (!request) return;
        
        // WebSocket orqali menejerga xabar yuborish
        if (global.broadcastWebSocket) {
            const notification = {
                type: 'debt_comparison',
                request_id: requestId,
                request_uid: request.request_uid,
                user_id: user.id,
                user_name: user.fullname,
                comparison_result: comparisonResult,
                message: comparisonResult.isIdentical 
                    ? 'Qardorlik o\'xshash ekanligi aniqlandi'
                    : 'Farqlar topildi',
                timestamp: new Date().toISOString()
            };
            
            global.broadcastWebSocket('debt_comparison', notification);
        }
        
        log.info(`Comparison notification sent to manager: requestId=${requestId}, isIdentical=${comparisonResult.isIdentical}`);
    } catch (error) {
        log.error('Error sending comparison notification to manager:', error);
    }
}

/**
 * Maksimal fayl hajmini olish
 */
async function getMaxFileSize() {
    try {
        const setting = await db('debt_settings').where('key', 'max_file_size_mb').first();
        if (setting) {
            return parseInt(setting.value) || 20;
        }
        return 20; // Default 20 MB
    } catch (error) {
        log.error('Error getting max file size:', error);
        return 20;
    }
}

module.exports = {
    sendExcelTemplate,
    handleExcelFile,
    handleSelectSingleColumn,
    handleSelectColumnValue,
    handleConfirmColumns,
    handleConfirmExcel,
    handleEditExcel,
    showExcelPreview,
    showDebtPreviewWithComparison,
    formatDifferencesMessage
};

