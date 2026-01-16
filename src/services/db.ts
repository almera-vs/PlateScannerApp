import { open, type DB } from '@op-engineering/op-sqlite';
import { Plate, PlateCheckResult } from '../types';

const DATABASE_NAME = 'PlateScannerDB';

class DatabaseService {
    private db: DB | null = null;
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
    public initDB(): void {
        try {
            if (this.db) {
                return; // Already initialized
            }

            this.db = open({
                name: DATABASE_NAME,
            });

            this.db.executeSync(`
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
    public addPlate(plateNumber: string, isManual: boolean): Plate | null {
        try {
            if (!this.db) {
                this.initDB();
            }

            const normalizedPlate = plateNumber.toUpperCase().trim();
            const scanDate = new Date().toISOString();

            const result = this.db!.executeSync(
                `INSERT INTO plates (plate_number, scan_date, is_manual) VALUES (?, ?, ?)`,
                [normalizedPlate, scanDate, isManual ? 1 : 0],
            );

            if (result.insertId) {
                return {
                    id: result.insertId,
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
                error?.message?.includes('SQLITE_CONSTRAINT')
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
    public checkPlate(plateNumber: string): PlateCheckResult {
        try {
            if (!this.db) {
                this.initDB();
            }

            const normalizedPlate = plateNumber.toUpperCase().trim();

            const result = this.db!.executeSync(
                `SELECT id, plate_number, scan_date, is_manual FROM plates WHERE plate_number = ?`,
                [normalizedPlate],
            );

            if (result.rows && result.rows.length > 0) {
                const row = result.rows[0] as any;
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
    public getAllPlates(): Plate[] {
        try {
            if (!this.db) {
                this.initDB();
            }

            const result = this.db!.executeSync(
                `SELECT id, plate_number, scan_date, is_manual FROM plates ORDER BY scan_date DESC`,
            );

            const plates: Plate[] = [];
            if (result.rows) {
                for (const row of result.rows as any[]) {
                    plates.push({
                        id: row.id,
                        plate_number: row.plate_number,
                        scan_date: row.scan_date,
                        is_manual: row.is_manual === 1,
                    });
                }
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
    public deletePlate(id: number): void {
        try {
            if (!this.db) {
                this.initDB();
            }

            this.db!.executeSync(`DELETE FROM plates WHERE id = ?`, [id]);
        } catch (error) {
            console.error('Failed to delete plate:', error);
            throw error;
        }
    }

    /**
     * Close the database connection
     */
    public closeDB(): void {
        try {
            if (this.db) {
                this.db.close();
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
