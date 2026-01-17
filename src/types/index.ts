// TypeScript types for the PlateScannerApp

export interface Plate {
    id: number;
    plate_number: string;
    scan_date: string;
    last_scan_date?: string; // New: updated on re-scan
    is_manual: boolean;
    scan_count?: number; // New: frequency counter
}

export type PlateInput = Omit<Plate, 'id'>;

export interface PlateCheckResult {
    exists: boolean;
    plate?: Plate;
}

// Navigation types
export type RootStackParamList = {
    Home: undefined;
    ManualEntry: undefined;
    History: undefined;
};

// Camera/Scanner types
export interface ScanResult {
    text: string;
    isValidPlate: boolean;
}
