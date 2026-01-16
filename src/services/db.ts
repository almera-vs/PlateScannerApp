import SQLite, {
    SQLiteDatabase,
    ResultSet,
} from 'react-native-sqlite-storage';
import { Plate, PlateCheckResult } from '../types';

// Enable promise-based API
SQLite.enablePromise(true);

const DATABASE_NAME = 'PlateScannerDB.db';

class DatabaseService {
    private db: SQLiteDatabase | null = null;
    private static instance: DatabaseService;

    private constructor() { }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    /**
     * Initialize the database and create tables if they don't exist
     */
    public async initDB(): Promise<void> {
        try {
            if (this.db) {
                return; // Already initialized
            }

            this.db = await SQLite.openDatabase({
                name: DATABASE_NAME,
                location: 'default',
            });

            await this.db.executeSql(`
        CREATE TABLE IF NOT EXISTS plates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plate_number TEXT UNIQUE NOT NULL,
          scan_date TEXT NOT NULL,
          is_manual INTEGER NOT NULL DEFAULT 0
        )
      `);

            console.log('Database initialized successfully');
        } catch (error) {
            console.error('Failed to initialize database:', error);
            throw error;
        }
    }

    /**
     * Add a new plate to the database
     * @param plateNumber - The license plate number
     * @param isManual - Whether the plate was entered manually
     * @returns The inserted plate or null if duplicate
     */
    public async addPlate(
        plateNumber: string,
        isManual: boolean,
    ): Promise<Plate | null> {
        try {
            if (!this.db) {
                await this.initDB();
            }

            const normalizedPlate = plateNumber.toUpperCase().trim();
            const scanDate = new Date().toISOString();

            const result: [ResultSet] = await this.db!.executeSql(
                `INSERT INTO plates (plate_number, scan_date, is_manual) VALUES (?, ?, ?)`,
                [normalizedPlate, scanDate, isManual ? 1 : 0],
            );

            if (result[0].insertId) {
                return {
                    id: result[0].insertId,
                    plate_number: normalizedPlate,
                    scan_date: scanDate,
                    is_manual: isManual,
                };
            }

            return null;
        } catch (error: any) {
            // Handle unique constraint violation (duplicate plate)
            if (
                error?.message?.includes('UNIQUE constraint failed') ||
                error?.code === 'SQLITE_CONSTRAINT'
            ) {
                console.log('Duplicate plate detected:', plateNumber);
                return null;
            }
            console.error('Failed to add plate:', error);
            throw error;
        }
    }

    /**
     * Check if a plate exists in the database
     * @param plateNumber - The license plate number to check
     * @returns PlateCheckResult with exists flag and plate data if found
     */
    public async checkPlate(plateNumber: string): Promise<PlateCheckResult> {
        try {
            if (!this.db) {
                await this.initDB();
            }

            const normalizedPlate = plateNumber.toUpperCase().trim();

            const result: [ResultSet] = await this.db!.executeSql(
                `SELECT id, plate_number, scan_date, is_manual FROM plates WHERE plate_number = ?`,
                [normalizedPlate],
            );

            if (result[0].rows.length > 0) {
                const row = result[0].rows.item(0);
                return {
                    exists: true,
                    plate: {
                        id: row.id,
                        plate_number: row.plate_number,
                        scan_date: row.scan_date,
                        is_manual: row.is_manual === 1,
                    },
                };
            }

            return { exists: false };
        } catch (error) {
            console.error('Failed to check plate:', error);
            throw error;
        }
    }

    /**
     * Get all plates from the database ordered by scan_date DESC
     * @returns Array of all plates
     */
    public async getAllPlates(): Promise<Plate[]> {
        try {
            if (!this.db) {
                await this.initDB();
            }

            const result: [ResultSet] = await this.db!.executeSql(
                `SELECT id, plate_number, scan_date, is_manual FROM plates ORDER BY scan_date DESC`,
            );

            const plates: Plate[] = [];
            for (let i = 0; i < result[0].rows.length; i++) {
                const row = result[0].rows.item(i);
                plates.push({
                    id: row.id,
                    plate_number: row.plate_number,
                    scan_date: row.scan_date,
                    is_manual: row.is_manual === 1,
                });
            }

            return plates;
        } catch (error) {
            console.error('Failed to get all plates:', error);
            throw error;
        }
    }

    /**
     * Delete a plate from the database
     * @param id - The plate ID to delete
     */
    public async deletePlate(id: number): Promise<void> {
        try {
            if (!this.db) {
                await this.initDB();
            }

            await this.db!.executeSql(`DELETE FROM plates WHERE id = ?`, [id]);
        } catch (error) {
            console.error('Failed to delete plate:', error);
            throw error;
        }
    }

    /**
     * Close the database connection
     */
    public async closeDB(): Promise<void> {
        try {
            if (this.db) {
                await this.db.close();
                this.db = null;
                console.log('Database closed');
            }
        } catch (error) {
            console.error('Failed to close database:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const db = DatabaseService.getInstance();
export default db;
