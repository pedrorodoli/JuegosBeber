const mysql = require('mysql2/promise');

// Database connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'juegosbeber',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Function to initialize the database schema
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        await connection.query(`
            CREATE TABLE IF NOT EXISTS rooms (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                gameType VARCHAR(50) NOT NULL,
                isPublic BOOLEAN NOT NULL,
                password VARCHAR(255) NULL,
                creatorId VARCHAR(255) NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            );
        `);
        await connection.query(`
            CREATE TABLE IF NOT EXISTS game_states (
                room_id VARCHAR(255) PRIMARY KEY,
                state_json JSON NOT NULL,
                FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
            );
        `);
        connection.release();
        console.log('Database schema initialized successfully.');
    } catch (error) {
        console.error('Error initializing database schema:', error);
        process.exit(1); // Exit if database cannot be initialized
    }
}

// CRUD operations for rooms
async function createRoom(roomData) {
    const { id, name, gameType, isPublic, password, creatorId } = roomData;
    const [result] = await pool.query(
        'INSERT INTO rooms (id, name, gameType, isPublic, password, creatorId) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, gameType, isPublic, password, creatorId]
    );
    return result;
}

async function getRoomById(roomId) {
    const [rows] = await pool.query('SELECT * FROM rooms WHERE id = ?', [roomId]);
    return rows[0];
}

async function getAllRooms(gameType = null) {
    let query = 'SELECT id, name, gameType, isPublic, password FROM rooms';
    let params = [];
    if (gameType) {
        query += ' WHERE gameType = ?';
        params.push(gameType);
    }
    const [rows] = await pool.query(query, params);
    return rows.map(row => ({
        id: row.id,
        name: row.name,
        gameType: row.gameType,
        isPublic: row.isPublic,
        hasPassword: !!row.password // Indicate if password exists without exposing it
    }));
}

async function updateRoom(roomId, roomData) {
    const { name, isPublic, password } = roomData;
    const [result] = await pool.query(
        'UPDATE rooms SET name = ?, isPublic = ?, password = ? WHERE id = ?',
        [name, isPublic, password, roomId]
    );
    return result;
}

async function deleteRoom(roomId) {
    const [result] = await pool.query('DELETE FROM rooms WHERE id = ?', [roomId]);
    return result;
}

// CRUD operations for game states
async function createGameState(roomId, gameState) {
    const [result] = await pool.query(
        'INSERT INTO game_states (room_id, state_json) VALUES (?, ?)',
        [roomId, JSON.stringify(gameState)]
    );
    return result;
}



async function getGameState(roomId) {
    const [rows] = await pool.query('SELECT state_json FROM game_states WHERE room_id = ?', [roomId]);
    if (rows.length > 0) {
        return rows[0].state_json;
    }
    return null;
}

async function updateGameState(roomId, gameState) {
    const [result] = await pool.query(
        'UPDATE game_states SET state_json = ? WHERE room_id = ?',
        [JSON.stringify(gameState), roomId]
    );
    return result;
}

async function deleteGameState(roomId) {
    const [result] = await pool.query('DELETE FROM game_states WHERE room_id = ?', [roomId]);
    return result;
}

async function deleteAllRooms() {
    try {
        const [result] = await pool.query('DELETE FROM rooms');
        console.log(`🧹 All rooms deleted: ${result.affectedRows} rooms removed.`);
        return result;
    } catch (error) {
        console.error('Error deleting all rooms:', error);
        throw error;
    }
}

module.exports = {
    initializeDatabase,
    createRoom,
    getRoomById,
    getAllRooms,
    updateRoom,
    deleteRoom,
    deleteAllRooms, // <-- Export the new function
    createGameState,
    getGameState,
    updateGameState,
    deleteGameState,
    pool // Export pool for direct queries if needed
};