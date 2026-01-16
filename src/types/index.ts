// TypeScript types for the PlateScannerApp

export interface Plate {
    id: number;
    plate_number: string;
    scan_date: string;
    is_manual: boolean;
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
