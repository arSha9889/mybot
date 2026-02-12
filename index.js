require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Подключаем БД
const db = new sqlite3.Database('./reminders.db');

// Создаём таблицу, если её нет
db.run(`CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  remind_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Загружаем сохранённые напоминания при старте
db.all('SELECT * FROM reminders WHERE remind_at > ?', [new Date().toISOString()], (err, rows) => {
  if (err) throw err;
  rows.forEach(row => scheduleReminder(row));
});

// ==================== КОМАНДЫ ====================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 
    `👋 Привет, ${msg.from.first_name}!\n\n` +
    `Я бот-напоминалка. Напиши:\n` +
    `/remind купить молоко через 5 минут\n` +
    `/remind позвонить через 2 часа\n` +
    `/remind таймер через 30 секунд\n\n` +
    `/list — список напоминаний\n` +
    `/cancel 1 — удалить напоминание №1`
  );
});

// ==================== /remind ====================
bot.onText(/\/remind (.+) через (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const text = match[1].trim();
  const timeStr = match[2].trim().toLowerCase();

  const seconds = parseTime(timeStr);
  if (!seconds) {
    return bot.sendMessage(chatId, '❌ Не понимаю время. Примеры: "5 минут", "2 часа", "30 секунд"');
  }

  const remindAt = new Date(Date.now() + seconds * 1000);
  const remindAtISO = remindAt.toISOString();

  db.run(
    'INSERT INTO reminders (chat_id, text, remind_at) VALUES (?, ?, ?)',
    [chatId, text, remindAtISO],
    function(err) {
      if (err) {
        console.error(err);
        return bot.sendMessage(chatId, '❌ Ошибка сохранения');
      }

      const reminderId = this.lastID;
      scheduleReminder({
        id: reminderId,
        chat_id: chatId,
        text,
        remind_at: remindAtISO
      });

      bot.sendMessage(chatId, 
        `✅ Напоминание #${reminderId} создано\n` +
        `📝 ${text}\n` +
        `🕐 Через ${formatTime(seconds)}`
      );
    }
  );
});

// ==================== /list ====================
bot.onText(/\/list/, (msg) => {
  const chatId = msg.chat.id;
  
  db.all(
    'SELECT id, text, remind_at FROM reminders WHERE chat_id = ? ORDER BY remind_at',
    [chatId],
    (err, rows) => {
      if (err) return bot.sendMessage(chatId, '❌ Ошибка загрузки');
      if (rows.length === 0) return bot.sendMessage(chatId, '📭 Нет активных напоминаний');

      const list = rows.map(r => {
        const secondsLeft = Math.max(0, (new Date(r.remind_at) - new Date()) / 1000);
        return `#${r.id} — ${r.text}\n   ⏳ осталось ${formatTime(secondsLeft)}`;
      }).join('\n\n');

      bot.sendMessage(chatId, `📋 Активные напоминания:\n\n${list}`);
    }
  );
});

// ==================== /cancel ====================
bot.onText(/\/cancel (\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const reminderId = parseInt(match[1]);

  db.run(
    'DELETE FROM reminders WHERE id = ? AND chat_id = ?',
    [reminderId, chatId],
    function(err) {
      if (err) return bot.sendMessage(chatId, '❌ Ошибка удаления');
      if (this.changes === 0) return bot.sendMessage(chatId, '❌ Напоминание не найдено');
      bot.sendMessage(chatId, `🗑 Напоминание #${reminderId} удалено`);
    }
  );
});

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

// Парсит время: "5 минут", "2 часа", "30 секунд" → секунды
function parseTime(str) {
  const match = str.match(/^(\d+)\s*(секунд|сек|минут|мин|часов|час|часа)$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2];

  if (unit.includes('секунд') || unit.includes('сек')) return value;
  if (unit.includes('минут') || unit.includes('мин')) return value * 60;
  if (unit.includes('час')) return value * 3600;

  return null;
}

// Форматирует секунды в читаемый вид
function formatTime(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)} сек`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} мин`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins ? `${hours} ч ${mins} мин` : `${hours} ч`;
}

// Планировщик напоминаний
function scheduleReminder(reminder) {
  const now = new Date();
  const remindAt = new Date(reminder.remind_at);
  const delay = remindAt - now;

  if (delay <= 0) {
    // Просроченное — удаляем
    db.run('DELETE FROM reminders WHERE id = ?', [reminder.id]);
    return;
  }

  setTimeout(async () => {
    bot.sendMessage(reminder.chat_id, `⏰ НАПОМИНАНИЕ #${reminder.id}\n📝 ${reminder.text}`);
    db.run('DELETE FROM reminders WHERE id = ?', [reminder.id]);
  }, delay);
}

// ==================== ЗАПУСК ====================
console.log('🤖 Бот запущен и готов к работе!');