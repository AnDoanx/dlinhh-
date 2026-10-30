const fs = require('fs');
const path = require('path');
const config = require('./config');

let mode; // 'mysql' | 'sqlite'
let pool;
let sqliteDb;

const SQL_PRODUCTS_STOCK_SUB = `
  (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count
`;

function getAdminIds() {
  if (Array.isArray(config.ADMIN_IDS)) {
    return config.ADMIN_IDS.map(id => String(id));
  } else if (config.ADMIN_ID) {
    return [String(config.ADMIN_ID)];
  }
  return [];
}

async function queryAll(sql, params = []) {
  if (mode === 'mysql') {
    const [rows] = await pool.query(sql, params);
    return rows;
  }
  return sqliteDb.prepare(sql).all(params);
}

async function queryRun(sql, params = []) {
  if (mode === 'mysql') {
    const [result] = await pool.query(sql, params);
    return {
      insertId: result.insertId != null ? Number(result.insertId) : undefined,
      affectedRows: result.affectedRows
    };
  }
  const info = sqliteDb.prepare(sql).run(params);
  return { insertId: Number(info.lastInsertRowid), affectedRows: info.changes };
}

async function initMysql() {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  const connection = await pool.getConnection();
  try {
    await connection.ping();
    await connection.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        custom_emoji_id VARCHAR(255) DEFAULT NULL
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY AUTO_INCREMENT,
        category_id INT DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        price INT NOT NULL,
        description TEXT,
        price_tiers TEXT,
        seller_price INT DEFAULT NULL,
        custom_emoji_id VARCHAR(255) DEFAULT NULL
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS sellers (
        user_id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS stock (
        id INT PRIMARY KEY AUTO_INCREMENT,
        product_id INT NOT NULL,
        account_data TEXT NOT NULL,
        is_sold TINYINT DEFAULT 0,
        buyer_id BIGINT,
        INDEX idx_product_sold (product_id, is_sold)
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        product_id INT NOT NULL,
        stock_id INT,
        status VARCHAR(50) DEFAULT 'pending',
        chat_id BIGINT,
        content TEXT,
        quantity INT DEFAULT 1,
        total_price INT,
        delivered_data TEXT,
        created_at BIGINT,
        INDEX idx_user_status (user_id, status),
        INDEX idx_status (status)
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        first_name VARCHAR(255),
        username VARCHAR(255),
        balance BIGINT DEFAULT 0,
        spins INT DEFAULT 0,
        lang VARCHAR(10) DEFAULT 'vi',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        amount INT NOT NULL,
        content VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at BIGINT,
        INDEX idx_deposit_user (user_id),
        INDEX idx_deposit_status (status)
      )
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS blacklist (
        user_id VARCHAR(50) PRIMARY KEY,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try { await connection.query(`ALTER TABLE categories ADD COLUMN custom_emoji_id VARCHAR(255) DEFAULT NULL`); } catch (_) {}
    try { await connection.query(`ALTER TABLE products ADD COLUMN category_id INT DEFAULT 0`); } catch (_) {}
    try { await connection.query(`ALTER TABLE products ADD COLUMN custom_emoji_id VARCHAR(255) DEFAULT NULL`); } catch (_) {}
    try { await connection.query(`ALTER TABLE products ADD COLUMN seller_price INT DEFAULT NULL`); } catch (_) {}
    try { await connection.query(`ALTER TABLE users ADD COLUMN balance BIGINT DEFAULT 0`); } catch (_) {}
    try { await connection.query(`ALTER TABLE users ADD COLUMN spins INT DEFAULT 0`); } catch (_) {}
    try { await connection.query(`ALTER TABLE users ADD COLUMN lang VARCHAR(10) DEFAULT 'vi'`); } catch (_) {}
    try { await connection.query(`ALTER TABLE users ADD COLUMN verified TINYINT DEFAULT 0`); await connection.query(`UPDATE users SET verified = 1`); } catch (_) {}
    try { await connection.query(`ALTER TABLE orders ADD COLUMN delivered_data TEXT`); } catch (_) {}
    try { await connection.query(`ALTER TABLE blacklist ADD COLUMN reason TEXT`); } catch (_) {}
  } finally {
    connection.release();
  }
}

function initSqlite() {
  const Database = require('better-sqlite3');
  const dbPath = config.SQLITE_PATH || path.join(__dirname, 'data', 'shop.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      custom_emoji_id TEXT DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      description TEXT,
      price_tiers TEXT,
      seller_price INTEGER DEFAULT NULL,
      custom_emoji_id TEXT DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS sellers (
      user_id TEXT PRIMARY KEY,
      name TEXT DEFAULT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      account_data TEXT NOT NULL,
      is_sold INTEGER DEFAULT 0,
      buyer_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_stock_product_sold ON stock(product_id, is_sold);
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      stock_id INTEGER,
      status TEXT DEFAULT 'pending',
      chat_id INTEGER,
      content TEXT,
      quantity INTEGER DEFAULT 1,
      total_price INTEGER,
      delivered_data TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      balance INTEGER DEFAULT 0,
      spins INTEGER DEFAULT 0,
      lang TEXT DEFAULT 'vi',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
    CREATE TABLE IF NOT EXISTS blacklist (
      user_id TEXT PRIMARY KEY,
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try { sqliteDb.exec(`ALTER TABLE categories ADD COLUMN custom_emoji_id TEXT DEFAULT NULL;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE products ADD COLUMN category_id INTEGER DEFAULT 0;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE products ADD COLUMN custom_emoji_id TEXT DEFAULT NULL;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE products ADD COLUMN seller_price INTEGER DEFAULT NULL;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE users ADD COLUMN balance INTEGER DEFAULT 0;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE users ADD COLUMN spins INTEGER DEFAULT 0;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'vi';`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE users ADD COLUMN verified INTEGER DEFAULT 0;`); sqliteDb.exec(`UPDATE users SET verified = 1;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE orders ADD COLUMN delivered_data TEXT;`); } catch (_) {}
  try { sqliteDb.exec(`ALTER TABLE blacklist ADD COLUMN reason TEXT;`); } catch (_) {}
}

async function initDB() {
  const onlySqlite = config.DB_MODE === 'sqlite';
  const onlyMysql = config.DB_MODE === 'mysql';

  if (!onlySqlite) {
    try {
      await initMysql();
      mode = 'mysql';
      console.log('Ã°ÂÂÂ¦ Database: MySQL');
      return;
    } catch (err) {
      if (onlyMysql) throw err;
      if (pool) { try { await pool.end(); } catch (_) { } pool = null; }
    }
  }

  initSqlite();
  mode = 'sqlite';
  console.log('Ã°ÂÂÂ¦ Database: SQLite');
}

function parsePriceTiersJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed
      .map((t) => ({ min: parseInt(t.min, 10), price: parseInt(t.price, 10) }))
      .filter((t) => !isNaN(t.min) && t.min >= 1 && !isNaN(t.price) && t.price >= 0)
      .sort((a, b) => a.min - b.min);
  } catch {
    return null;
  }
}

function hasSellerPrice(product) {
  if (!product) return false;
  const sp = product.seller_price;
  if (sp === null || sp === undefined || sp === '') return false;
  const n = Number(sp);
  return Number.isFinite(n) && n >= 0;
}

/**
 * LÃ¡ÂºÂ¥y giÃÂ¡ nÃ¡Â»Ân ÃÂ¡p dÃ¡Â»Â¥ng cho ngÃÂ°Ã¡Â»Âi ÃÂang mua.
 * - KhÃÂ¡ch thÃÂ°Ã¡Â»Âng  -> product.price
 * - Seller        -> product.seller_price (nÃ¡ÂºÂ¿u ÃÂÃÂ£ cÃÂ i), chÃÂ°a cÃÂ i thÃÂ¬ rÃÂ¡i vÃ¡Â»Â giÃÂ¡ thÃÂ°Ã¡Â»Âng
 */
function getBaseUnitPrice(product, isSeller = false) {
  if (isSeller && hasSellerPrice(product)) return Number(product.seller_price);
  return Number(product.price) || 0;
}

function effectiveUnitPrice(product, quantity, isSeller = false) {
  const base = getBaseUnitPrice(product, isSeller);
  const qty = Math.max(0, parseInt(quantity, 10) || 0);
  const tiers = product.price_tiers;
  if (!tiers?.length || qty < 1) return base;
  const sorted = [...tiers].sort((a, b) => b.min - a.min);
  for (const t of sorted) {
    if (qty >= t.min) {
      // Seller ÃÂÃÂ£ cÃÂ³ giÃÂ¡ riÃÂªng: chÃ¡Â»Â ÃÂn giÃÂ¡ sÃ¡Â»Â khi nÃÂ³ cÃÂ²n rÃ¡ÂºÂ» hÃÂ¡n giÃÂ¡ seller.
      if (isSeller && Number(t.price) >= base) return base;
      return Number(t.price);
    }
  }
  return base;
}

function calculatePrice(product, quantity, isSeller = false) {
  return effectiveUnitPrice(product, quantity, isSeller) * (parseInt(quantity, 10) || 0);
}

function getUnitPrice(product, quantity, isSeller = false) {
  return effectiveUnitPrice(product, quantity, isSeller);
}

// ========== BLACKLIST (CÃ¡ÂºÂ¤M NGÃÂ¯Ã¡Â»ÂI DÃÂNG) ==========
async function getBlacklist() {
  const rows = await queryAll('SELECT user_id, reason FROM blacklist');
  return rows.map(r => ({
    userId: String(r.user_id),
    reason: r.reason || 'Vi phÃ¡ÂºÂ¡m chÃÂ­nh sÃÂ¡ch'
  }));
}

async function addToBlacklist(userId, reason = '') {
  const uid = String(userId);
  if (mode === 'mysql') {
    return await queryRun(
      'INSERT INTO blacklist (user_id, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = ?',
      [uid, reason, reason]
    );
  }
  return await queryRun(
    'INSERT INTO blacklist (user_id, reason) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET reason = excluded.reason',
    [uid, reason]
  );
}

async function removeFromBlacklist(userId) {
  return await queryRun('DELETE FROM blacklist WHERE user_id = ?', [String(userId)]);
}

// ========== CATEGORIES ==========
async function getAllCategories() {
  const rows = await queryAll(`
    SELECT c.id, c.name, c.description, c.custom_emoji_id,
    (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count
    FROM categories c
  `);
  return rows.map(r => ({ 
    id: r.id, 
    name: r.name, 
    description: r.description, 
    custom_emoji_id: r.custom_emoji_id || null,
    product_count: parseInt(r.product_count, 10) || 0 
  }));
}

async function getCategory(id) {
  const rows = await queryAll('SELECT * FROM categories WHERE id = ?', [id]);
  return rows[0] || null;
}

async function addCategory(name, description = '', customEmojiId = null) {
  const res = await queryRun(
    'INSERT INTO categories (name, description, custom_emoji_id) VALUES (?, ?, ?)', 
    [name, description, customEmojiId]
  );
  return { lastInsertRowid: res.insertId };
}

async function updateCategoryEmoji(id, customEmojiId) {
  return await queryRun('UPDATE categories SET custom_emoji_id = ? WHERE id = ?', [customEmojiId, id]);
}

async function syncCategoryEmojiToProducts(catId, customEmojiId) {
  return await queryRun('UPDATE products SET custom_emoji_id = ? WHERE category_id = ?', [customEmojiId, catId]);
}

async function deleteCategory(id) {
  await queryRun('UPDATE products SET category_id = 0 WHERE category_id = ?', [id]);
  await queryRun('DELETE FROM categories WHERE id = ?', [id]);
}

// ========== PRODUCTS ==========
async function getAllProducts() {
  const rows = await queryAll(
    `SELECT p.id, p.category_id, p.name, p.price, p.seller_price, p.description, p.price_tiers, p.custom_emoji_id, ${SQL_PRODUCTS_STOCK_SUB} FROM products p`
  );
  return rows.map((row) => ({
    id: row.id,
    category_id: row.category_id || 0,
    name: row.name,
    price: row.price,
    description: row.description,
    price_tiers: parsePriceTiersJson(row.price_tiers),
    seller_price: (row.seller_price === null || row.seller_price === undefined || row.seller_price === '') ? null : parseInt(row.seller_price, 10),
    custom_emoji_id: row.custom_emoji_id || null,
    stock_count: parseInt(row.stock_count, 10) || 0
  }));
}

async function getProductsByCategory(categoryId) {
  const rows = await queryAll(
    `SELECT p.id, p.category_id, p.name, p.price, p.seller_price, p.description, p.price_tiers, p.custom_emoji_id, ${SQL_PRODUCTS_STOCK_SUB} 
     FROM products p WHERE p.category_id = ?`,
    [categoryId]
  );
  return rows.map((row) => ({
    id: row.id,
    category_id: row.category_id || 0,
    name: row.name,
    price: row.price,
    description: row.description,
    price_tiers: parsePriceTiersJson(row.price_tiers),
    seller_price: (row.seller_price === null || row.seller_price === undefined || row.seller_price === '') ? null : parseInt(row.seller_price, 10),
    custom_emoji_id: row.custom_emoji_id || null,
    stock_count: parseInt(row.stock_count, 10) || 0
  }));
}

async function getProduct(id) {
  const rows = await queryAll(
    `SELECT p.id, p.category_id, p.name, p.price, p.seller_price, p.description, p.price_tiers, p.custom_emoji_id, ${SQL_PRODUCTS_STOCK_SUB}
     FROM products p WHERE p.id = ?`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    category_id: row.category_id || 0,
    name: row.name,
    price: row.price,
    description: row.description,
    price_tiers: parsePriceTiersJson(row.price_tiers),
    seller_price: (row.seller_price === null || row.seller_price === undefined || row.seller_price === '') ? null : parseInt(row.seller_price, 10),
    custom_emoji_id: row.custom_emoji_id || null,
    stock_count: parseInt(row.stock_count, 10) || 0
  };
}

async function addProduct(name, price, description = '', categoryId = 0) {
  const result = await queryRun(
    'INSERT INTO products (name, price, description, category_id) VALUES (?, ?, ?, ?)',
    [name, price, description, categoryId]
  );
  return { lastInsertRowid: result.insertId };
}

async function deleteProduct(id) {
  await queryRun('DELETE FROM stock WHERE product_id = ?', [id]);
  await queryRun('DELETE FROM products WHERE id = ?', [id]);
}

async function updateProductCategory(productId, categoryId) {
  await queryRun('UPDATE products SET category_id = ? WHERE id = ?', [categoryId, productId]);
}

async function addStock(productId, accountData) {
  await queryRun('INSERT INTO stock (product_id, account_data) VALUES (?, ?)', [productId, accountData]);
}

async function deleteStock(stockId) {
  await queryRun('DELETE FROM stock WHERE id = ? AND is_sold = 0', [stockId]);
}

async function clearStock(productId) {
  await queryRun('DELETE FROM stock WHERE product_id = ? AND is_sold = 0', [productId]);
}

async function getAvailableStock(productId) {
  const rows = await queryAll(
    'SELECT id, product_id, account_data FROM stock WHERE product_id = ? AND is_sold = 0 LIMIT 1',
    [productId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return { id: row.id, product_id: row.product_id, account_data: row.account_data };
}

async function markStockSold(stockId, buyerId) {
  await queryRun('UPDATE stock SET is_sold = 1, buyer_id = ? WHERE id = ?', [buyerId, stockId]);
}

async function createOrder(userId, productId, chatId, content, quantity, totalPrice) {
  const createdAt = Date.now();
  const result = await queryRun(
    'INSERT INTO orders (user_id, product_id, chat_id, content, quantity, total_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, productId, chatId, content, quantity, totalPrice, createdAt]
  );
  return { lastInsertRowid: result.insertId, createdAt };
}

async function updateOrder(orderId, stockId, status, deliveredData = null) {
  if (deliveredData !== null) {
    await queryRun('UPDATE orders SET stock_id = ?, status = ?, delivered_data = ? WHERE id = ?', [stockId, status, deliveredData, orderId]);
  } else {
    await queryRun('UPDATE orders SET stock_id = ?, status = ? WHERE id = ?', [stockId, status, orderId]);
  }
}

async function getOrderById(orderId) {
  const rows = await queryAll(
    `SELECT o.*, p.name as product_name 
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.id = ?`,
    [orderId]
  );
  return rows[0] || null;
}

async function getPendingOrders() {
  const rows = await queryAll(`
    SELECT id, user_id, product_id, chat_id, content, quantity, total_price, created_at
    FROM orders
    WHERE status = 'pending' AND content IS NOT NULL
  `);
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    chatId: row.chat_id,
    content: row.content,
    quantity: row.quantity,
    totalPrice: row.total_price,
    createdAt: row.created_at
  }));
}

async function getOrdersByUser(userId) {
  const rows = await queryAll(
    `SELECT o.id, o.status, p.name as product_name, o.total_price, o.quantity, o.created_at, o.delivered_data
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.user_id = ?
     ORDER BY o.id DESC`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    product_name: row.product_name,
    total_price: row.total_price || 0,
    quantity: row.quantity || 1,
    created_at: row.created_at,
    delivered_data: row.delivered_data
  }));
}

async function saveUser(id, firstName, username) {
  if (mode === 'mysql') {
    await queryRun(
      'INSERT INTO users (id, first_name, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE first_name = ?, username = ?',
      [id, firstName, username, firstName, username]
    );
  } else {
    await queryRun(
      `INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username`,
      [id, firstName, username]
    );
  }
}

async function getAllUsers() {
  const rows = await queryAll('SELECT id, first_name, username, balance, spins, lang FROM users');
  return rows.map((row) => ({
    id: row.id,
    first_name: row.first_name,
    username: row.username,
    balance: parseInt(row.balance, 10) || 0,
    spins: parseInt(row.spins, 10) || 0,
    lang: row.lang || 'vi'
  }));
}

async function updateProduct(id, name, price, description) {
  await queryRun('UPDATE products SET name = ?, price = ?, description = ? WHERE id = ?', [name, price, description, id]);
}

async function updatePriceTiers(id, priceTiers) {
  const tiersJson = priceTiers ? JSON.stringify(priceTiers) : null;
  await queryRun('UPDATE products SET price_tiers = ? WHERE id = ?', [tiersJson, id]);
}

async function updateSellerPrice(id, price) {
  const value = (price === null || price === undefined || price === '') ? null : parseInt(price, 10);
  await queryRun('UPDATE products SET seller_price = ? WHERE id = ?', [Number.isFinite(value) ? value : null, id]);
}

// ========== SELLER (ÃÂÃ¡ÂºÂ I LÃÂ / CÃ¡Â»ÂNG TÃÂC VIÃÂN) ==========
async function getAllSellers() {
  const rows = await queryAll('SELECT user_id, name FROM sellers');
  return rows.map(r => ({
    userId: String(r.user_id),
    name: r.name || null
  }));
}

async function getSeller(userId) {
  const uid = String(userId).trim();
  const rows = await queryAll('SELECT user_id, name FROM sellers WHERE user_id = ?', [uid]);
  if (!rows.length) return null;
  return { userId: String(rows[0].user_id), name: rows[0].name || null };
}

async function addSeller(userId, name = null) {
  const uid = String(userId).trim();
  if (mode === 'mysql') {
    return await queryRun(
      'INSERT INTO sellers (user_id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = ?',
      [uid, name, name]
    );
  }
  return await queryRun(
    'INSERT INTO sellers (user_id, name) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET name = excluded.name',
    [uid, name]
  );
}

async function removeSeller(userId) {
  return await queryRun('DELETE FROM sellers WHERE user_id = ?', [String(userId).trim()]);
}

async function getStockByProduct(productId) {
  const rows = await queryAll('SELECT id, account_data, is_sold, buyer_id FROM stock WHERE product_id = ?', [productId]);
  return rows.map((row) => ({
    id: row.id,
    account_data: row.account_data,
    is_sold: row.is_sold,
    buyer_id: row.buyer_id
  }));
}

async function getOrderHistory(userId) {
  const rows = await queryAll(
    `SELECT o.id, o.status, p.name as product_name, o.total_price, o.quantity, o.created_at, o.delivered_data
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.user_id = ? AND o.status IN ('completed', 'pending', 'expired', 'cancelled')
     ORDER BY o.id DESC
     LIMIT 20`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    product_name: row.product_name,
    total_price: row.total_price,
    quantity: row.quantity,
    created_at: row.created_at,
    delivered_data: row.delivered_data
  }));
}

async function getRevenue() {
  const adminIds = getAdminIds();
  let adminFilterClause = '';
  const params = [];

  if (adminIds.length > 0) {
    const placeholders = adminIds.map(() => '?').join(',');
    adminFilterClause = ` AND user_id NOT IN (${placeholders})`;
    params.push(...adminIds);
  }

  const rows = await queryAll(`
    SELECT COUNT(*) as total_orders, COALESCE(SUM(total_price), 0) as total_revenue
    FROM orders
    WHERE status = 'completed' ${adminFilterClause}
  `, params);

  const row = rows[0] || {};
  return {
    total_orders: parseInt(row.total_orders, 10) || 0,
    total_revenue: parseInt(row.total_revenue, 10) || 0
  };
}

async function getTodayRevenue() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const todayDateStr = formatter.format(new Date());
  const startOfDayMs = new Date(`${todayDateStr}T00:00:00+07:00`).getTime();

  try {
    const adminIds = getAdminIds();
    let adminFilterClause = '';
    const params = [startOfDayMs];

    if (adminIds.length > 0) {
      const placeholders = adminIds.map(() => '?').join(',');
      adminFilterClause = ` AND user_id NOT IN (${placeholders})`;
      params.push(...adminIds);
    }

    const rows = await queryAll(`
      SELECT COUNT(*) as today_orders, COALESCE(SUM(total_price), 0) as today_revenue
      FROM orders
      WHERE status = 'completed' AND created_at >= ? ${adminFilterClause}
    `, params);

    const row = rows[0] || {};
    return {
      today_orders: parseInt(row.today_orders, 10) || 0,
      today_revenue: parseInt(row.today_revenue, 10) || 0
    };
  } catch (e) {
    console.error('LÃ¡Â»Âi tÃÂ­nh doanh thu hÃÂ´m nay:', e.message);
    return { today_orders: 0, today_revenue: 0 };
  }
}

async function getRecentOrders(limit = 20) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 20);
  const rows = await queryAll(
    `SELECT o.id, o.user_id, o.status, p.name, o.total_price, o.quantity, u.first_name, o.created_at
     FROM orders o
     JOIN products p ON o.product_id = p.id
     LEFT JOIN users u ON o.user_id = u.id
     ORDER BY o.id DESC
     LIMIT ${safeLimit}`
  );
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    product_name: row.name,
    total_price: row.total_price,
    quantity: row.quantity || 1,
    user_name: row.first_name || 'KhÃÂ¡ch',
    created_at: row.created_at
  }));
}


async function getOrdersCount() {
  try {
    const rows = await queryAll('SELECT COUNT(*) AS c FROM orders');
    return parseInt(rows?.[0]?.c, 10) || 0;
  } catch (e) {
    console.error('Lá»i Äáº¿m ÄÆ¡n hÃ ng:', e.message);
    return 0;
  }
}

async function getOrdersPage(offset = 0, limit = 12) {
  const safeLimit = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const rows = await queryAll(
    `SELECT o.id, o.user_id, o.status, p.name, o.total_price, o.quantity, u.first_name, o.created_at
     FROM orders o
     JOIN products p ON o.product_id = p.id
     LEFT JOIN users u ON o.user_id = u.id
     ORDER BY o.id DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`
  );
  return rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    product_name: row.name,
    total_price: row.total_price,
    quantity: row.quantity || 1,
    user_name: row.first_name || 'KhÃ¡ch',
    created_at: row.created_at
  }));
}

/* Doanh thu cá»§a Má»T ngÃ y (UTC+7) */
async function getRevenueForDay(dayStr) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(dayStr || '')) ? String(dayStr) : null;
  if (!day) return { day: null, orders: 0, revenue: 0 };
  const start = new Date(day + 'T00:00:00+07:00').getTime();
  const end = start + 24 * 60 * 60 * 1000;
  const adminIds = getAdminIds();
  let adminFilterClause = '';
  const params = [start, end];
  if (adminIds.length > 0) {
    adminFilterClause = ` AND o.user_id NOT IN (${adminIds.map(() => '?').join(',')})`;
    params.push(...adminIds);
  }
  try {
    const rows = await queryAll(
      `SELECT COUNT(*) AS c, COALESCE(SUM(o.total_price), 0) AS total
       FROM orders o
       WHERE o.status = 'completed' AND o.created_at >= ? AND o.created_at < ?${adminFilterClause}`,
      params
    );
    const row = rows?.[0] || {};
    return { day, orders: parseInt(row.c, 10) || 0, revenue: parseInt(row.total, 10) || 0 };
  } catch (e) {
    console.error('Lá»i doanh thu theo ngÃ y:', e.message);
    return { day, orders: 0, revenue: 0 };
  }
}

/* Doanh thu tá»«ng ngÃ y trong Má»T thÃ¡ng -> [{ day, orders, revenue }] */
async function getRevenueMonth(monthStr) {
  const month = /^\d{4}-\d{2}$/.test(String(monthStr || '')) ? String(monthStr) : null;
  if (!month) return [];
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = new Date(month + '-01T00:00:00+07:00').getTime();
  const end = new Date(`${month}-${String(daysInMonth).padStart(2, '0')}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000;
  const adminIds = getAdminIds();
  let adminFilterClause = '';
  const params = [start, end];
  if (adminIds.length > 0) {
    adminFilterClause = ` AND o.user_id NOT IN (${adminIds.map(() => '?').join(',')})`;
    params.push(...adminIds);
  }
  try {
    const rows = await queryAll(
      `SELECT o.created_at, o.total_price FROM orders o
       WHERE o.status = 'completed' AND o.created_at >= ? AND o.created_at < ?${adminFilterClause}`,
      params
    );
    const bucket = new Map();
    for (const row of rows) {
      const ts = Number(row.created_at);
      if (!ts) continue;
      const d = new Date(ts + 7 * 60 * 60 * 1000);
      const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const cur = bucket.get(day) || { day, orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += parseInt(row.total_price, 10) || 0;
      bucket.set(day, cur);
    }
    return Array.from(bucket.values()).sort((a, b) => (a.day < b.day ? -1 : 1));
  } catch (e) {
    console.error('Lá»i doanh thu theo thÃ¡ng:', e.message);
    return [];
  }
}


/* ---------- XÃ¡c minh ngÆ°á»i dÃ¹ng (captcha láº§n Äáº§u) ---------- */
async function isUserVerified(userId) {
  try {
    const rows = await queryAll('SELECT verified FROM users WHERE id = ?', [userId]);
    if (!rows || rows.length === 0) return false;
    return parseInt(rows[0].verified, 10) === 1;
  } catch (e) {
    // fail-open: thiáº¿u cá»t / DB lá»i thÃ¬ khÃ´ng ÄÆ°á»£c khoÃ¡ ngÆ°á»i dÃ¹ng
    return true;
  }
}

async function setUserVerified(userId) {
  /* Upsert: nguoi dung moi co the CHUA co row trong bang users (bam /start
   * roi giai captcha ngay). UPDATE ... WHERE id = ? se khop 0 dong -> mat
   * xac minh, user bi hoi captcha lai mai. Phai INSERT ... ON CONFLICT. */
  try {
    if (mode === 'mysql') {
      await queryRun(
        'INSERT INTO users (id, verified) VALUES (?, 1) ON DUPLICATE KEY UPDATE verified = 1',
        [userId]
      );
    } else {
      await queryRun(
        'INSERT INTO users (id, verified) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET verified = 1',
        [userId]
      );
    }
    return true;
  } catch (e) {
    /* Bang chua co cot verified (migration loi) -> thu UPDATE, khong chan user */
    try { await queryRun('UPDATE users SET verified = 1 WHERE id = ?', [userId]); return true; } catch (_) {}
    console.error('Loi luu xac minh:', e.message);
    return false;
  }
}

async function keepAlive() {
  try {
    if (mode === 'mysql') await pool.query('SELECT 1');
    else if (sqliteDb) sqliteDb.prepare('SELECT 1').get();
  } catch (error) {
    console.error('Ã¢ÂÂ Database keep-alive failed:', error.message);
  }
}

async function getUserLang(userId) {
  const rows = await queryAll('SELECT lang FROM users WHERE id = ?', [userId]);
  return rows?.[0]?.lang || null;
}

async function setUserLang(userId, lang) {
  return await queryRun('UPDATE users SET lang = ? WHERE id = ?', [lang, userId]);
}

async function getUserBalance(userId) {
  const rows = await queryAll('SELECT balance FROM users WHERE id = ?', [userId]);
  if (!rows || rows.length === 0) return 0;
  return parseInt(rows[0].balance, 10) || 0;
}

async function setUserBalance(userId, amount) {
  const val = Math.max(0, parseInt(amount, 10) || 0);
  return await queryRun('UPDATE users SET balance = ? WHERE id = ?', [val, userId]);
}

async function addMoney(userId, amount) {
  const addVal = parseInt(amount, 10) || 0;
  return await queryRun('UPDATE users SET balance = balance + ? WHERE id = ?', [addVal, userId]);
}

async function deductBalance(userId, amount) {
  const val = parseInt(amount, 10) || 0;
  return await queryRun('UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?', [val, userId, val]);
}

async function getUserSpins(userId) {
  const rows = await queryAll('SELECT spins FROM users WHERE id = ?', [userId]);
  if (!rows || rows.length === 0) return 0;
  return parseInt(rows[0].spins, 10) || 0;
}

async function addSpins(userId, count = 1) {
  const addCount = parseInt(count, 10) || 0;
  return await queryRun('UPDATE users SET spins = spins + ? WHERE id = ?', [addCount, userId]);
}

async function useSpin(userId) {
  const res = await queryRun('UPDATE users SET spins = spins - 1 WHERE id = ? AND spins > 0', [userId]);
  return res.affectedRows > 0;
}

async function createDeposit(userId, amount, content) {
  const createdAt = Date.now();
  const result = await queryRun(
    'INSERT INTO deposits (user_id, amount, content, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, amount, content, 'pending', createdAt]
  );
  return { id: result.insertId, createdAt };
}

async function getPendingDeposits() {
  const rows = await queryAll("SELECT id, user_id, amount, content, created_at FROM deposits WHERE status = 'pending'");
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    amount: r.amount,
    content: r.content,
    createdAt: r.created_at
  }));
}

async function updateDepositStatus(depositId, status) {
  await queryRun('UPDATE deposits SET status = ? WHERE id = ?', [status, depositId]);
}

async function getUserDepositStats(userId) {
  const rowsTotal = await queryAll(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM deposits WHERE user_id = ? AND status = 'completed'",
    [userId]
  );
  const totalDeposit = parseInt(rowsTotal[0]?.total, 10) || 0;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const rowsMonth = await queryAll(
    "SELECT COALESCE(SUM(amount), 0) AS total_month FROM deposits WHERE user_id = ? AND status = 'completed' AND created_at >= ?",
    [userId, startOfMonth]
  );
  const monthDeposit = parseInt(rowsMonth[0]?.total_month, 10) || 0;

  return { totalDeposit, monthDeposit };
}

// HÃ¡Â»Â trÃ¡Â»Â£ cÃ¡Â»Âng dÃ¡Â»Ân doanh sÃ¡Â»Â khi mua trÃ¡Â»Â±c tiÃ¡ÂºÂ¿p (vÃÂ­ hoÃ¡ÂºÂ·c QR) vÃÂ o top thÃÂ¡ng
async function addDepositOrSpend(userId, amount) {
  const addAmount = parseInt(amount, 10) || 0;
  if (addAmount <= 0) return;
  const createdAt = Date.now();
  await queryRun(
    'INSERT INTO deposits (user_id, amount, content, status, created_at) VALUES (?, ?, ?, ?, ?)',
    [userId, addAmount, 'DIRECT_SPEND', 'completed', createdAt]
  );
}

// TÃ¡Â»Â± ÃÂÃ¡Â»Âng reset theo thÃÂ¡ng hiÃ¡Â»Ân tÃ¡ÂºÂ¡i (lÃ¡Â»Âc tÃ¡Â»Â« ngÃÂ y 1 hÃÂ ng thÃÂ¡ng, loÃ¡ÂºÂ¡i trÃ¡Â»Â« Admin)
async function getTopDeposits(limit = 10) {
  const safeLimit = Math.max(1, parseInt(limit, 10) || 10);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const adminIds = getAdminIds();
  let adminFilterClause = '';
  const params = [startOfMonth];

  if (adminIds.length > 0) {
    const placeholders = adminIds.map(() => '?').join(',');
    adminFilterClause = ` AND u.id NOT IN (${placeholders})`;
    params.push(...adminIds);
  }

  const rows = await queryAll(`
    SELECT u.id, u.first_name, u.username, COALESCE(SUM(d.amount), 0) AS total_deposited
    FROM deposits d
    JOIN users u ON d.user_id = u.id
    WHERE d.status = 'completed' AND d.created_at >= ? ${adminFilterClause}
    GROUP BY u.id, u.first_name, u.username
    ORDER BY total_deposited DESC
    LIMIT ${safeLimit}
  `, params);

  return rows.map((r) => ({
    id: r.id,
    name: r.first_name || 'KhÃÂ¡ch',
    username: r.username || '',
    total: parseInt(r.total_deposited, 10) || 0
  }));
}

module.exports = {
  initDB,
  getAllCategories,
  getCategory,
  addCategory,
  updateCategoryEmoji,
  syncCategoryEmojiToProducts,
  deleteCategory,
  getAllProducts,
  getProductsByCategory,
  getProduct,
  addProduct,
  deleteProduct,
  updateProductCategory,
  addStock,
  deleteStock,
  clearStock,
  getAvailableStock,
  markStockSold,
  createOrder,
  updateOrder,
  getOrderById,
  getOrdersByUser,
  getPendingOrders,
  saveUser,
  isUserVerified,
  setUserVerified,
  getAllUsers,
  updateProduct,
  updatePriceTiers,
  updateSellerPrice,
  getAllSellers,
  getSeller,
  addSeller,
  removeSeller,
  getBaseUnitPrice,
  getStockByProduct,
  getOrderHistory,
  getRevenue,
  getTodayRevenue,
  getRecentOrders,
  getOrdersCount,
  getOrdersPage,
  getRevenueForDay,
  getRevenueMonth,
  keepAlive,
  calculatePrice,
  getUnitPrice,
  getUserBalance,
  setUserBalance,
  addMoney,
  deductBalance,
  getUserSpins,
  addSpins,
  useSpin,
  createDeposit,
  getPendingDeposits,
  updateDepositStatus,
  getUserDepositStats,
  addDepositOrSpend,
  getUserLang,
  setUserLang,
  getTopDeposits,
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist
};
