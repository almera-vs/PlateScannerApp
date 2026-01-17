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

            // Version 1 Table
            this.db.executeSync(`
        CREATE TABLE IF NOT EXISTS plates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          plate_number TEXT UNIQUE NOT NULL,
          scan_date TEXT NOT NULL,
          is_manual INTEGER NOT NULL DEFAULT 0
        )
      `);

            // Migration: Add scan_count and last_scan_date if they don't exist
            // SQLite doesn't support IF NOT EXISTS for columns, so we try/catch or check PRAGMA table_info
            // Simple approach: Try to add, ignore error if duplicate column
            try {
                this.db.executeSync(`ALTER TABLE plates ADD COLUMN scan_count INTEGER DEFAULT 1`);
            } catch (e) { /* Column likely exists */ }

            try {
                this.db.executeSync(`ALTER TABLE plates ADD COLUMN last_scan_date TEXT`);
            } catch (e) { /* Column likely exists */ }

            // Backfill last_scan_date for old records if null
            this.db.executeSync(`UPDATE plates SET last_scan_date = scan_date WHERE last_scan_date IS NULL`);

            console.log('Database initialized successfully');
        } catch (error) {
            console.error('Failed to initialize database:', error);
            throw error;
        }
    }

    /**
     * Add a newplate to the database OR update existing
     * @param plateNumber - The license plate number
     * @param isManual - Whether the plate was entered manually
     * @param forceUpdate - If true, increments count even if exists
     * @returns The inserted/updated plate or null if duplicate (and forceUpdate false)
     */
    public addPlate(plateNumber: string, isManual: boolean, forceUpdate: boolean = false): Plate | null {
        try {
            if (!this.db) {
                this.initDB();
            }

            const normalizedPlate = plateNumber.toUpperCase().trim();
            const now = new Date().toISOString();

            // Check existence first
            const existing = this.checkPlate(normalizedPlate);

            if (existing.exists && existing.plate) {
                if (forceUpdate) {
                    // UPDATE existing record
                    const newCount = (existing.plate.scan_count || 1) + 1;
                    this.db!.executeSync(
                        `UPDATE plates SET scan_count = ?, last_scan_date = ?, is_manual = ? WHERE id = ?`,
                        [newCount, now, isManual ? 1 : 0, existing.plate.id]
                    );
                    return {
                        ...existing.plate,
                        scan_count: newCount,
                        last_scan_date: now,
                        is_manual: isManual // Update source type to latest
                    };
                } else {
                    // Return null to signal duplicate (unless caller handles it)
                    return null;
                }
            }

            // INSERT new record
            const result = this.db!.executeSync(
                `INSERT INTO plates (plate_number, scan_date, last_scan_date, is_manual, scan_count) VALUES (?, ?, ?, ?, 1)`,
                [normalizedPlate, now, now, isManual ? 1 : 0],
            );

            if (result.insertId) {
                return {
                    id: result.insertId,
                    plate_number: normalizedPlate,
                    scan_date: now,
                    last_scan_date: now,
                    is_manual: isManual,
                    scan_count: 1
                };
            }

            return null;
        } catch (error: any) {
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
                `SELECT * FROM plates WHERE plate_number = ?`,
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
                        last_scan_date: row.last_scan_date || row.scan_date,
                        is_manual: row.is_manual === 1,
                        scan_count: row.scan_count || 1
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
     * Get all plates from the database ordered by last_scan_date DESC
     * @returns Array of all plates
     */
    public getAllPlates(): Plate[] {
        try {
            if (!this.db) {
                this.initDB();
            }

            const result = this.db!.executeSync(
                `SELECT * FROM plates ORDER BY last_scan_date DESC`,
            );

            const plates: Plate[] = [];
            if (result.rows) {
                for (const row of result.rows as any[]) {
                    plates.push({
                        id: row.id,
                        plate_number: row.plate_number,
                        scan_date: row.scan_date,
                        last_scan_date: row.last_scan_date || row.scan_date,
                        is_manual: row.is_manual === 1,
                        scan_count: row.scan_count || 1
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
