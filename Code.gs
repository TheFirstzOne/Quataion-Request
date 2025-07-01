// Google Sheet ID - already known by the script when attached to the sheet.
const SPREADSHEET_ID = "1XaR3lny5ui8-jmvVN2v68S3HRe_RxwR0JYzJ0E3aCdA"; // Not strictly needed if script is bound
const SHEET_NAME = "QuotationRequest";

// Telegram Bot Settings - ใส่ข้อมูลจากการสร้าง Bot
const TELEGRAM_BOT_TOKEN = "7967646027:AAHti6Dd_mSGdta6XfArgwhzigzpt8f1DaQ"; // ได้จาก @BotFather
const TELEGRAM_CHAT_IDS = [
"7572101335", // Chat ID ของผู้ใช้ 1
"-4971276512" // Chat ID ของกลุ่ม (เริ่มด้วย -)
// เพิ่ม Chat ID ได้ตามต้องการ
];

/**
 * Handles GET requests to the Web App.
 * This function determines which HTML page to serve based on URL parameters.
 * @param {GoogleAppsScript.Events.AppsScriptHttpRequestEvent} e The event object.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} The HTML page to be served.
 */
function doGet(e) {
  let page = 'index'; // Default page to serve

  // Check if a 'page' parameter is present in the URL
  if (e && e.parameter && e.parameter.page) {
    page = e.parameter.page;
  }

  let template;
  try {
    template = HtmlService.createTemplateFromFile(page);
  } catch (error) {
    // If the requested page file does not exist, fall back to index.html
    console.error(`Error loading template for page ${page}: ${error.message}. Falling back to index.html.`);
    template = HtmlService.createTemplateFromFile('index');
  }
  
  return template.evaluate()
      .setTitle("ระบบขอใบเสนอราคา - บริษัท อิมมอทัล พาร์ท จำกัด")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

/**
 * Returns the URL for the history page.
 * This function is called from client-side JavaScript via google.script.run.
 * @returns {string} The URL to the history.html page.
 */
function getHistoryPageUrl() {
  const url = ScriptApp.getService().getUrl();
  // Append a parameter to the URL to tell doGet to load history.html
  return url + '?page=history';
}

/**
 * Returns the URL for the main form page (index.html).
 * This function is called from client-side JavaScript via google.script.run.
 * @returns {string} The URL to the index.html page.
 */
function getIndexPageUrl() {
  const url = ScriptApp.getService().getUrl();
  // No parameter needed as index is the default, but can add '?page=index' for clarity if desired.
  return url;
}

/**
 * Retrieves all quotation request data from the specified Google Sheet.
 * @returns {Array<Array<any>>} A 2D array containing all rows from the sheet,
 * with the first row being headers.
 */
function getQuotationHistoryData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      console.log(`Sheet '${SHEET_NAME}' not found.`);
      return []; // Return empty array if sheet doesn't exist
    }

    // Get all data, including headers
    const data = sheet.getDataRange().getValues();
    return data;

  } catch (error) {
    console.error("Error in getQuotationHistoryData:", error.toString());
    return []; // Return empty array on error
  }
}


function submitQuotationRequest(formData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet(); 
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      const headers = [
        "วันที่ส่งคำขอ (Timestamp)", 
        "ชื่อผู้ขอ (Requester Name)", 
        "รายการอุปกรณ์ (Equipment List)", 
        "รายละเอียดเพิ่มเติม (Additional Details)", 
        "ชื่อไฟล์แนบ (File Attachment Name)", 
        "หมายเหตุ (Notes)"
      ];
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      for (let i = 1; i <= headers.length; i++) {
        sheet.autoResizeColumn(i);
      }
    }
    
    const requestDate = formData.timestamp ? new Date(formData.timestamp) : new Date();
    const requesterName = formData.requesterName || "";
    const equipmentListJSON = formData.equipmentList || "[]";
    const additionalDetails = formData.additionalDetails || "";
    const fileAttachmentName = formData.fileAttachmentName || "";
    const notes = formData.notes || "";

    // แปลงรูปแบบรายการอุปกรณ์ให้อ่านง่าย
    let equipmentListFormatted = "";
    try {
      const equipmentArray = JSON.parse(equipmentListJSON);
      equipmentListFormatted = equipmentArray.map(item => {
        return `${item.name} ${item.quantity} ${item.unit}`;
      }).join(',\n');
    } catch (error) {
      console.error("Error parsing equipment list JSON:", error);
      equipmentListFormatted = equipmentListJSON;
    }

    // บันทึกข้อมูลลง Sheet
    sheet.appendRow([
      requestDate,
      requesterName,
      equipmentListFormatted,
      additionalDetails,
      fileAttachmentName,
      notes
    ]);

    // *** ส่งการแจ้งเตือนผ่าน Telegram Bot ***
    sendTelegramNotification(formData, equipmentListFormatted);

    return { success: true, message: "Data saved successfully." };

  } catch (error) {
    console.error("Error in submitQuotationRequest: " + error.toString());
    return { success: false, error: error.toString() };
  }
}

// *** ฟังก์ชันส่งการแจ้งเตือนผ่าน Telegram Bot ***
function sendTelegramNotification(formData, equipmentListFormatted) {
  try {
    // ตรวจสอบการตั้งค่า Telegram Bot
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === "") { // Changed from "YOUR_BOT_TOKEN_HERE" for robustness
      console.log("Telegram Bot Token not configured. Skipping Telegram notification.");
      return;
    }

    if (!TELEGRAM_CHAT_IDS || TELEGRAM_CHAT_IDS.length === 0) {
      console.log("No Telegram Chat IDs configured. Skipping Telegram notification.");
      return;
    }

    // จัดรูปแบบวันที่เวลา
    const thaiDate = new Date(formData.timestamp).toLocaleDateString('th-TH', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // สร้างข้อความ Telegram ด้วย HTML formatting
    let telegramMessage = `🔔 <b>คำขอใบเสนอราคาใหม่</b>\n`;
    telegramMessage += `━━━━━━━━━━━━━━━━━━━━\n`;
    telegramMessage += `📅 <b>วันที่:</b> ${thaiDate}\n`;
    telegramMessage += `👤 <b>ผู้ขอ:</b> ${formData.requesterName}\n\n`;
    
    telegramMessage += `📋 <b>รายการอุปกรณ์:</b>\n`;
    if (equipmentListFormatted) {
      const equipmentLines = equipmentListFormatted.split(',\n');
      equipmentLines.forEach((item, index) => {
        telegramMessage += `${index + 1}. ${item.trim()}\n`;
      });
    } else {
      telegramMessage += `<i>ไม่มีรายการ</i>\n`;
    }

    if (formData.additionalDetails) {
      telegramMessage += `\n📝 <b>รายละเอียดเพิ่มเติม:</b>\n`;
      telegramMessage += `<i>${formData.additionalDetails}</i>\n`;
    }

    if (formData.fileAttachmentName) {
      telegramMessage += `\n📎 <b>ไฟล์แนบ:</b> ${formData.fileAttachmentName}\n`;
    }

    if (formData.notes) {
      telegramMessage += `\n💭 <b>หมายเหตุ:</b>\n`;
      telegramMessage += `<i>${formData.notes}</i>\n`;
    }

    //telegramMessage += `\n💼 <b>บริษัท  อิมมอทัล พาร์ท จำกัด</b>`;

    // ส่งข้อความไปยัง Chat IDs ทั้งหมด
    TELEGRAM_CHAT_IDS.forEach(chatId => {
      sendTelegramMessage(chatId, telegramMessage);
    });

  } catch (error) {
    console.error("Error sending Telegram notification:", error.toString());
  }
}

// ฟังก์ชันส่งข้อความ Telegram ไปยัง Chat ID เดียว
function sendTelegramMessage(chatId, message) {
  try {
    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const payload = {
      'chat_id': chatId,
      'text': message,
      'parse_mode': 'HTML', // ใช้ HTML formatting
      'disable_web_page_preview': true // ปิดการแสดง preview ของ link
    };

    const response = UrlFetchApp.fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload)
    });

    const responseCode = response.getResponseCode();
    const responseData = JSON.parse(response.getContentText());
    
    if (responseCode === 200 && responseData.ok) {
      console.log(`Telegram message sent successfully to Chat ID: ${chatId}`);
    } else {
      console.error(`Failed to send Telegram message to Chat ID ${chatId}:`, responseData.description);
    }

  } catch (error) {
    console.error(`Error sending Telegram message to Chat ID ${chatId}:`, error.toString());
  }
}

// ฟังก์ชันส่งข้อความพร้อม Inline Keyboard
function sendTelegramMessageWithKeyboard(chatId, message, keyboardButtons) {
  try {
    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const payload = {
      'chat_id': chatId,
      'text': message,
      'parse_mode': 'HTML',
      'disable_web_page_preview': true,
      'reply_markup': {
        'inline_keyboard': keyboardButtons
      }
    };

    const response = UrlFetchApp.fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload)
    });

    const responseCode = response.getResponseCode();
    const responseData = JSON.parse(response.getContentText());
    
    if (responseCode === 200 && responseData.ok) {
      console.log(`Telegram message with keyboard sent successfully to Chat ID: ${chatId}`);
    } else {
      console.error(`Failed to send Telegram message with keyboard to Chat ID ${chatId}:`, responseData.description);
    }

  } catch (error) {
    console.error(`Error sending Telegram message with keyboard to Chat ID ${chatId}:`, error.toString());
  }
}

// ฟังก์ชันขั้นสูง: ส่งข้อความพร้อมปุ่มตอบกลับด่วน
function sendAdvancedTelegramNotification(formData, equipmentListFormatted) {
  try {
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === "") { // Changed from "YOUR_BOT_TOKEN_HERE"
      console.log("Telegram Bot Token not configured.");
      return;
    }

    // สร้างข้อความ
    const thaiDate = new Date(formData.timestamp).toLocaleDateString('th-TH', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let message = `🔔 <b>คำขอใบเสนอราคาใหม่</b>\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📅 <b>วันที่:</b> ${thaiDate}\n`;
    message += `👤 <b>ผู้ขอ:</b> ${formData.requesterName}\n\n`;
    message += `📋 <b>รายการอุปกรณ์:</b>\n`;
    
    if (equipmentListFormatted) {
      const equipmentLines = equipmentListFormatted.split(',\n');
      equipmentLines.forEach((item, index) => {
        message += `${index + 1}. ${item.trim()}\n`;
      });
    }

    // สร้าง Inline Keyboard
    const keyboardButtons = [
      [
        {
          'text': '✅ รับเรื่อง',
          'callback_data': `accept_${Date.now()}`
        },
        {
          'text': '📞 ติดต่อกลับ',
          'callback_data': `callback_${Date.now()}`
        }
      ],
      [
        {
          'text': '📊 ดูใน Google Sheet',
          'url': `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`
        }
      ]
    ];

    // ส่งไปยัง Chat IDs ทั้งหมด
    TELEGRAM_CHAT_IDS.forEach(chatId => {
      sendTelegramMessageWithKeyboard(chatId, message, keyboardButtons);
    });

  } catch (error) {
    console.error("Error sending advanced Telegram notification:", error.toString());
  }
}

// ฟังก์ชันดึง Chat ID ของผู้ใช้ที่ส่งข้อความมาให้ Bot
function getTelegramUpdates() {
  try {
    if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === "") { // Changed from "YOUR_BOT_TOKEN_HERE"
      console.log("Telegram Bot Token not configured.");
      return;
    }

    const apiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
    
    const response = UrlFetchApp.fetch(apiUrl);
    const responseData = JSON.parse(response.getContentText());
    
    if (responseData.ok) {
      console.log("Recent Telegram updates:");
      responseData.result.forEach(update => {
        if (update.message) {
          console.log(`Chat ID: ${update.message.chat.id}`);
          console.log(`From: ${update.message.from.first_name} ${update.message.from.last_name || ''}`);
          console.log(`Message: ${update.message.text || '[No text]'}`);
          console.log('---');
        }
      });
    }
    
    return responseData;

  } catch (error) {
    console.error("Error getting Telegram updates:", error.toString());
  }
}

// Helper function to test from Apps Script Editor
function testSubmit() {
  const testData = {
    timestamp: new Date().toISOString(),
    requesterName: "ทดสอบระบบ Telegram",
    equipmentList: JSON.stringify([
      { name: "ปั๊มน้ำแรงมาก", quantity: "1", unit: "ตัว" },
      { name: "ปั๊มน้ำแรงปานกลาง", quantity: "2", unit: "ตัว" },
      { name: "วาล์วควบคุม", quantity: "5", unit: "ชิ้น" }
    ]),
    additionalDetails: "ต้องการใช้งานเร่งด่วน กรุณาส่งใบเสนอราคาภายใน 2 วัน",
    fileAttachmentName: "diagram.pdf",
    notes: "กรุณาติดต่อกลับด่วน เบอร์ 02-xxx-xxxx"
  };
  const result = submitQuotationRequest(testData);
  console.log(result);
}

// ฟังก์ชันทดสอบการส่ง Telegram แยกต่างหาก
function testTelegramNotification() {
  const testData = {
    timestamp: new Date().toISOString(),
    requesterName: "ทดสอบ Telegram Bot",
    equipmentList: JSON.stringify([
      { name: "ปั๊มน้ำทดสอบ", quantity: "1", unit: "ตัว" },
      { name: "มอเตอร์ทดสอบ", quantity: "2", unit: "ตัว" }
    ]),
    additionalDetails: "ทดสอบการส่งข้อความ Telegram Bot",
    fileAttachmentName: "test_document.pdf",
    notes: "ข้อความทดสอบจากระบบ"
  };
  
  const equipmentListFormatted = "ปั๊มน้ำทดสอบ 1 ตัว,\nมอเตอร์ทดสอบ 2 ตัว";
  sendTelegramNotification(testData, equipmentListFormatted);
}

// ฟังก์ชันทดสอบการส่งข้อความแบบมีปุ่ม
function testAdvancedTelegramNotification() {
  const testData = {
    timestamp: new Date().toISOString(),
    requesterName: "ทดสอบ Advanced Telegram",
    equipmentList: JSON.stringify([
      { name: "อุปกรณ์ทดสอบ", quantity: "1", unit: "ชิ้น" }
    ]),
    additionalDetails: "ทดสอบการส่งข้อความพร้อมปุ่ม",
    fileAttachmentName: "",
    notes: ""
  };
  
  const equipmentListFormatted = "อุปกรณ์ทดสอบ 1 ชิ้น";
  sendAdvancedTelegramNotification(testData, equipmentListFormatted);
}
