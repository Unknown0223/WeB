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
        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl qabul qilish boshlanmoqda: userId=${userId}, chatId=${chatId}`);
        
        const state = stateManager.getUserState(userId);
        log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] State ma'lumotlari: hasState=${!!state}, context=${state?.context}, state=${state?.state}, requestId=${state?.data?.request_id}`);
        
        if (!state || (state.context !== stateManager.CONTEXTS.DEBT_APPROVAL && state.context !== stateManager.CONTEXTS.HISOBOT)) {
            log.debug(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] State topilmadi yoki context mos kelmaydi: hasState=${!!state}, context=${state?.context}`);
            return false;
        }
        
        // Faqat DEBT_APPROVAL context uchun tekshirish (HISOBOT uchun tekshirish yo'q)
        if (state.context === stateManager.CONTEXTS.DEBT_APPROVAL && state.state === STATES.UPLOAD_DEBT_EXCEL) {
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
        
        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl topildi: fileName=${fileName}, fileId=${fileId}, fileSize=${fileSize} bytes, userId=${userId}, requestId=${state.data?.request_id}`);
        
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
        
        // Excel faylni o'qish
        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel faylni o'qish boshlanmoqda: filePath=${filePath}`);
        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
        
        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl o'qildi: totalRows=${data.length}, sheetName=${sheetName}`);
        
        if (data.length < 2) {
            log.warn(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Excel fayl bo'sh yoki noto'g'ri formatda: rows=${data.length}`);
            await bot.sendMessage(chatId, '❌ Excel fayl bo\'sh yoki noto\'g\'ri formatda.');
            fs.unlinkSync(filePath);
            return true;
        }
        
        // Headers va data ajratish
        const headers = data[0].map(h => h ? String(h).trim() : '');
        const rows = data.slice(1).filter(row => row.some(cell => cell !== null && cell !== ''));
        
        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Headers va qatorlar ajratildi: headersCount=${headers.length}, rowsCount=${rows.length}`);
        
        // Ustunlarni aniqlash
        const detectedColumns = detectColumns(headers);
        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Ustunlar aniqlandi: detectedColumns=${JSON.stringify(detectedColumns)}`);
        
        // State'ni yangilash (bir nechta marta fayl yuborilganda, eski ma'lumotlar yangilanadi)
        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] State yangilanmoqda: userId=${userId}, requestId=${state.data?.request_id}`);
        stateManager.updateUserState(userId, state.state, {
            ...state.data,
            excel_file_path: filePath,
            excel_headers: headers,
            excel_raw_data: rows,
            excel_columns: detectedColumns,
            excel_detected: detectedColumns,
            last_file_upload_time: Date.now() // Bir nechta marta fayl yuborilganda tracking uchun
        });
        
        // Agar barcha kerakli ustunlar topilgan bo'lsa, to'g'ridan-to'g'ri validatsiya
        if (detectedColumns.id !== null && detectedColumns.name !== null && detectedColumns.summa !== null) {
            log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Barcha kerakli ustunlar topildi, validatsiya boshlanmoqda`);
            // Request ma'lumotlarini olish
            const requestData = await getRequestDataForValidation(state, userId);
            
            // Validatsiya va filtrlash
            const validationResult = validateAndFilterRows(
                rows.map(row => {
                    const rowObj = {};
                    headers.forEach((header, index) => {
                        rowObj[header] = row[index];
                    });
                    return rowObj;
                }),
                detectedColumns,
                requestData,
                headers
            );
            
            // State'ni yangilash
            stateManager.updateUserState(userId, state.state, {
                ...state.data,
                excel_data: validationResult.filtered,
                excel_total: validationResult.filtered.reduce((sum, row) => {
                    const summaHeader = headers[detectedColumns.summa];
                    const summaValue = row[summaHeader];
                    const summa = summaValue !== undefined && summaValue !== null
                        ? parseFloat(String(summaValue).replace(/\s/g, '').replace(/,/g, '.'))
                        : 0;
                    return sum + (isNaN(summa) ? 0 : summa);
                }, 0)
            });
            
            // Preview ko'rsatish
            log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Preview ko'rsatish boshlanmoqda: userId=${userId}, requestId=${state.data?.request_id}`);
            await showExcelPreview(userId, chatId, bot, state);
        } else {
            // Manual ustun tanlash
            log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] Manual ustun tanlash boshlanmoqda: userId=${userId}, requestId=${state.data?.request_id}`);
            await showColumnSelection(userId, chatId, bot, headers, detectedColumns);
        }
        
        log.info(`[DEBT_EXCEL] [HANDLE_EXCEL_FILE] ✅ Excel fayl muvaffaqiyatli qabul qilindi va qayta ishlandi: userId=${userId}, requestId=${state.data?.request_id}, fileName=${fileName}`);
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
            
            return request || {};
        }
        
        // Agar request_id yo'q bo'lsa, state'dan olish
        return {
            brand_name: state.data.brand_name,
            svr_name: state.data.svr_name
        };
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
        
        keyboard.inline_keyboard.push([{ text: '✅ Tasdiqlash', callback_data: 'debt_confirm_columns' }]);
        keyboard.inline_keyboard.push([{ text: '❌ Bekor qilish', callback_data: 'debt_cancel_excel' }]);
        
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
        
        let comparisonResult = null;
        if (request && request.excel_data) {
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
                
                // Agar bir xil bo'lsa, xabar berish (lekin jarayon davom etadi - operatorga yuboriladi)
                if (comparisonResult.isIdentical) {
                    log.info(`[DEBT_EXCEL] ⚠️ Ma'lumotlar bir xil, lekin operatorga yuboriladi`);
                    
                    // Menejerga ham xabar yuborish (web orqali)
                    await sendComparisonNotificationToManager(actualRequestId, comparisonResult, user);
                    
                    // Xabarni yangilash - tasdiqlash xabari (lekin jarayon davom etadi)
                    try {
                        await bot.editMessageText(
                            '✅ <b>Qardorlik o\'xshash ekanligi aniqlandi</b>\n\n' +
                            'Yuborilgan Excel fayldagi ma\'lumotlar so\'rovdagi ma\'lumotlar bilan bir xil.\n\n' +
                            'Ma\'lumotlar operatorga yuborilmoqda...',
                            {
                                chat_id: chatId,
                                message_id: query.message.message_id,
                                parse_mode: 'HTML'
                            }
                        );
                    } catch (error) {
                        // Agar xabarni yangilab bo'lmasa, yangi xabar yuborish
                        log.warn('Could not edit message, sending new message:', error.message);
                        await bot.sendMessage(
                            chatId,
                            '✅ <b>Qardorlik o\'xshash ekanligi aniqlandi</b>\n\n' +
                            'Yuborilgan Excel fayldagi ma\'lumotlar so\'rovdagi ma\'lumotlar bilan bir xil.\n\n' +
                            'Ma\'lumotlar operatorga yuborilmoqda...',
                            { parse_mode: 'HTML' }
                        );
                    }
                    // return qilinmaydi - jarayon davom etadi va operatorga yuboriladi
                }
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
        
        // Foydalanuvchi roliga qarab to'g'ri sendDebtResponse funksiyasini chaqirish
        // Avval current_approver_type ni tekshirish (so'rovga tayinlangan rolni aniqlash)
        let isOperator = false;
        if (request && request.current_approver_type === 'operator' && request.current_approver_id === user.id) {
            // So'rovga operator sifatida tayinlangan
            isOperator = true;
            log.info(`[DEBT_EXCEL] [CONFIRM] So'rovga operator sifatida tayinlangan: requestId=${actualRequestId}, userId=${user.id}`);
        } else if (request && request.current_approver_type === 'cashier' && request.current_approver_id === user.id) {
            // So'rovga kassir sifatida tayinlangan
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
        
        if (isOperator) {
            // Operator uchun sendDebtResponse
            const operatorHandlers = require('./operator.js');
            await operatorHandlers.sendDebtResponse(actualRequestId, userId, chatId, debtData);
        } else if (userHelper.hasRole(user, ['kassir', 'cashier']) || (request && request.current_approver_type === 'cashier')) {
            // Kassir uchun sendDebtResponse
            const cashierHandlers = require('./cashier.js');
            await cashierHandlers.sendDebtResponse(actualRequestId, userId, chatId, debtData);
        } else {
            log.warn(`Unknown role for debt response: userId=${userId}, role=${user.role}, current_approver_type=${request?.current_approver_type}`);
            await bot.sendMessage(chatId, '❌ Bu funksiya faqat kassir va operatorlar uchun.');
            return;
        }
        
        // Agar farq bo'lsa, farqlarni ko'rsatish
        if (comparisonResult && !comparisonResult.isIdentical && comparisonResult.differences.length > 0) {
            const differencesMessage = formatDifferencesMessage(comparisonResult);
            await bot.sendMessage(chatId, differencesMessage, { parse_mode: 'HTML' });
            
            // Menejerga ham xabar yuborish (web orqali)
            await sendComparisonNotificationToManager(actualRequestId, comparisonResult, user);
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
            excel_columns: state.data.excel_columns
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
                originalMap.set(idKey, {
                    id: idKey,
                    name: getRowName(row, originalHeaders, originalColumns),
                    summa: summa
                });
                originalMappedCount++;
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
                newMap.set(idKey, {
                    id: idKey,
                    name: getRowName(row, newHeaders, newColumns),
                    summa: summa
                });
                newMappedCount++;
            } else if (index < 3) {
                log.debug(`[COMPARE] New row ${index} ID topilmadi, row keys:`, Object.keys(row || {}));
            }
        });
        
        log.debug(`[COMPARE] Mapped: Original=${originalMappedCount}/${originalData.length}, New=${newMappedCount}/${newData.length}`);
        
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
            } else if (Math.abs((originalRow.summa || 0) - (newRow.summa || 0)) > 0.01) {
                // Summa o'zgardi
                differences.push({
                    type: 'changed',
                    id: id,
                    name: newRow.name,
                    original_summa: originalRow.summa,
                    new_summa: newRow.summa,
                    difference: newRow.summa - originalRow.summa
                });
                totalDifference += Math.abs((newRow.summa || 0) - (originalRow.summa || 0));
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
    return value ? String(value).trim() : null;
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
    return isNaN(num) ? 0 : num;
}

/**
 * Farqlarni formatlash
 */
function formatDifferencesMessage(comparisonResult) {
    if (!comparisonResult || !comparisonResult.canCompare) {
        return '';
    }
    
    if (comparisonResult.isIdentical) {
        return '✅ Ma\'lumotlar bir xil';
    }
    
    let message = '📊 <b>Farqlar topildi:</b>\n\n';
    
    if (comparisonResult.differences.length > 0) {
        // Faqat birinchi 10 ta farqni ko'rsatish
        const shownDifferences = comparisonResult.differences.slice(0, 10);
        
        shownDifferences.forEach((diff, index) => {
            if (diff.type === 'new') {
                message += `${index + 1}. ➕ <b>Yangi:</b> ${diff.name || diff.id} - ${diff.summa?.toLocaleString('ru-RU') || 0} so'm\n`;
            } else if (diff.type === 'removed') {
                message += `${index + 1}. ➖ <b>O'chirilgan:</b> ${diff.name || diff.id} - ${diff.summa?.toLocaleString('ru-RU') || 0} so'm\n`;
            } else if (diff.type === 'changed') {
                message += `${index + 1}. 🔄 <b>O'zgargan:</b> ${diff.name || diff.id}\n`;
                message += `   Eski: ${diff.original_summa?.toLocaleString('ru-RU') || 0} so'm\n`;
                message += `   Yangi: ${diff.new_summa?.toLocaleString('ru-RU') || 0} so'm\n`;
                message += `   Farq: ${diff.difference > 0 ? '+' : ''}${diff.difference.toLocaleString('ru-RU')} so'm\n`;
            }
        });
        
        if (comparisonResult.differences.length > 10) {
            message += `\n... va yana ${comparisonResult.differences.length - 10} ta farq\n`;
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
    showExcelPreview
};

