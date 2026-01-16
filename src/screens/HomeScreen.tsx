import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    Linking,
    ActivityIndicator,
    Dimensions,
} from 'react-native';
import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    PhotoFile,
} from 'react-native-vision-camera';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

import db from '../services/db';
import { RootStackParamList } from '../types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SCAN_FRAME_WIDTH = SCREEN_WIDTH - 60;
const SCAN_FRAME_HEIGHT = 120;

// EU License plate patterns - more flexible for European plates
// Polish: 2-3 letters + 4-5 alphanumeric (e.g., WZ 12345, DW 1AB23)
// German: 1-3 letters + 1-2 letters + 1-4 numbers (e.g., B AB 123)
// Standard EU: 1-3 region + space + 3-6 alphanumeric
const PLATE_PATTERNS = [
    /^[A-Z]{2,3}\s?[A-Z0-9]{4,5}$/,     // Polish standard
    /^[A-Z]{1,3}\s?[A-Z]{1,2}\s?[0-9]{1,4}[A-Z]?$/,  // German style
    /^[A-Z0-9]{5,8}$/,                   // Generic 5-8 alphanumeric
    /^[A-Z]{1,2}\s?[0-9]{2,4}\s?[A-Z]{2,3}$/,  // UK style
];

// Minimum interval between scans in ms
const SCAN_DEBOUNCE_MS = 2000;

export const HomeScreen: React.FC = () => {
    const navigation = useNavigation<NavigationProp>();
    const { hasPermission, requestPermission } = useCameraPermission();
    const device = useCameraDevice('back');
    const camera = useRef<Camera>(null);
    const isFocused = useIsFocused();

    const [isScanning, setIsScanning] = useState(false);
    const [lastScanTime, setLastScanTime] = useState(0);
    const [lastScannedPlate, setLastScannedPlate] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string>('Naciśnij SKANUJ aby rozpocząć');

    useEffect(() => {
        // Initialize database on component mount
        try {
            db.initDB();
        } catch (error) {
            console.error('Failed to initialize DB:', error);
            Alert.alert('Błąd', 'Nie udało się zainicjować bazy danych');
        }
    }, []);

    const validatePlate = useCallback((text: string): string | null => {
        // Normalize: uppercase, keep spaces for multi-part plates
        const normalized = text.toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();

        // Skip if too short or too long
        if (normalized.length < 5 || normalized.length > 10) {
            return null;
        }

        // Check against multiple EU patterns
        for (const pattern of PLATE_PATTERNS) {
            if (pattern.test(normalized)) {
                // Return without spaces for DB storage
                return normalized.replace(/\s/g, '');
            }
        }

        return null;
    }, []);

    const processRecognizedText = useCallback(
        (recognizedTexts: string[]): string | null => {
            // Find valid plates from recognized text blocks
            for (const text of recognizedTexts) {
                // Split text by common separators and check each segment
                const segments = text.split(/[\n\r\t,;|]+/);
                for (const segment of segments) {
                    const words = segment.trim().split(/\s+/);

                    // Try combining adjacent words (for "WZ 12345" style plates)
                    for (let i = 0; i < words.length; i++) {
                        // Single word
                        const validPlate = validatePlate(words[i]);
                        if (validPlate) {
                            return validPlate;
                        }

                        // Two adjacent words
                        if (i < words.length - 1) {
                            const combined = words[i] + ' ' + words[i + 1];
                            const validCombined = validatePlate(combined);
                            if (validCombined) {
                                return validCombined;
                            }
                        }
                    }
                }
            }
            return null;
        },
        [validatePlate],
    );

    const handlePlateDetected = useCallback(
        async (plateNumber: string) => {
            // Avoid re-processing the same plate repeatedly
            if (plateNumber === lastScannedPlate) {
                return;
            }

            setLastScannedPlate(plateNumber);
            setIsScanning(false);
            setStatusMessage(`Wykryto: ${plateNumber}`);

            // Check if plate exists in database
            const checkResult = db.checkPlate(plateNumber);

            if (checkResult.exists && checkResult.plate) {
                // DUPLICATE - Show RED alert
                const scanDate = format(
                    new Date(checkResult.plate.scan_date),
                    'dd.MM.yyyy HH:mm',
                    { locale: pl },
                );
                Alert.alert(
                    '⚠️ DUPLIKAT!',
                    `Tablica ${plateNumber} już istnieje w bazie.\n\nZgłoszony: ${scanDate}`,
                    [
                        {
                            text: 'OK',
                            onPress: () => {
                                setLastScannedPlate(null);
                                setStatusMessage('Naciśnij SKANUJ aby kontynuować');
                            },
                        },
                    ],
                    { cancelable: false },
                );
            } else {
                // NEW PLATE - Ask for confirmation before saving
                Alert.alert(
                    '🚗 Nowa tablica',
                    `Wykryto tablicę: ${plateNumber}\n\nCzy zgłosić pojazd?`,
                    [
                        {
                            text: 'Anuluj',
                            style: 'cancel',
                            onPress: () => {
                                setLastScannedPlate(null);
                                setStatusMessage('Anulowano. Naciśnij SKANUJ aby kontynuować');
                            },
                        },
                        {
                            text: 'Zgłoś',
                            style: 'default',
                            onPress: () => {
                                const savedPlate = db.addPlate(plateNumber, false);
                                if (savedPlate) {
                                    Alert.alert(
                                        '✅ ZAPISANO',
                                        `Tablica ${plateNumber} została zgłoszona.`,
                                        [
                                            {
                                                text: 'OK',
                                                onPress: () => {
                                                    setLastScannedPlate(null);
                                                    setStatusMessage('Zapisano! Naciśnij SKANUJ aby kontynuować');
                                                },
                                            },
                                        ],
                                    );
                                } else {
                                    Alert.alert('Błąd', 'Nie udało się zapisać tablicy.');
                                    setLastScannedPlate(null);
                                }
                            },
                        },
                    ],
                    { cancelable: false },
                );
            }
        },
        [lastScannedPlate],
    );

    const handleCapture = useCallback(async () => {
        const now = Date.now();

        // Debounce check
        if (now - lastScanTime < SCAN_DEBOUNCE_MS) {
            return;
        }

        if (!camera.current || isProcessing || !isScanning) {
            return;
        }

        setIsProcessing(true);
        setLastScanTime(now);
        setStatusMessage('Skanowanie...');

        try {
            // Take photo
            const photo: PhotoFile = await camera.current.takePhoto({
                flash: 'off',
            });

            // Perform OCR using ML Kit
            const result = await TextRecognition.recognize(`file://${photo.path}`);

            // Extract text blocks from ML Kit result
            const recognizedTexts = result.blocks.map(block => block.text);

            // Find valid plate
            const plateNumber = processRecognizedText(recognizedTexts);

            if (plateNumber) {
                await handlePlateDetected(plateNumber);
            } else {
                setStatusMessage('Szukam tablicy... skieruj kamerę na tablicę');
            }
        } catch (error) {
            console.error('Capture/OCR error:', error);
            setStatusMessage('Błąd skanowania. Spróbuj ponownie.');
        } finally {
            setIsProcessing(false);
        }
    }, [lastScanTime, isProcessing, isScanning, processRecognizedText, handlePlateDetected]);

    // Controlled scanning - only trigger when user presses button
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;

        if (isScanning && isFocused && device && hasPermission && !isProcessing) {
            // Scan every 1.5 seconds while scanning is active
            interval = setInterval(() => {
                handleCapture();
            }, 1500);
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isScanning, isFocused, device, hasPermission, isProcessing, handleCapture]);

    const handleRequestPermission = async () => {
        const granted = await requestPermission();
        if (!granted) {
            Alert.alert(
                'Wymagane uprawnienia',
                'Aplikacja wymaga dostępu do kamery. Przejdź do ustawień, aby nadać uprawnienia.',
                [
                    { text: 'Anuluj', style: 'cancel' },
                    { text: 'Ustawienia', onPress: () => Linking.openSettings() },
                ],
            );
        }
    };

    const toggleScanning = useCallback(() => {
        if (isScanning) {
            setIsScanning(false);
            setStatusMessage('Zatrzymano. Naciśnij SKANUJ aby wznowić');
        } else {
            setIsScanning(true);
            setLastScannedPlate(null);
            setStatusMessage('Skanowanie... skieruj tablicę w ramkę');
        }
    }, [isScanning]);

    if (!hasPermission) {
        return (
            <View style={styles.container}>
                <View style={styles.permissionContainer}>
                    <Text style={styles.permissionTitle}>Wymagany dostęp do kamery</Text>
                    <Text style={styles.permissionText}>
                        Aby skanować tablice rejestracyjne, aplikacja potrzebuje dostępu do
                        kamery.
                    </Text>
                    <TouchableOpacity
                        style={styles.permissionButton}
                        onPress={handleRequestPermission}>
                        <Text style={styles.permissionButtonText}>Nadaj uprawnienia</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    if (!device) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>Nie znaleziono kamery</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Camera
                ref={camera}
                style={StyleSheet.absoluteFill}
                device={device}
                isActive={isFocused}
                photo={true}
            />

            {/* Overlay */}
            <View style={styles.overlay}>
                {/* Instructions at top */}
                <View style={styles.topSection}>
                    <Text style={styles.instructionText}>
                        Umieść tablicę rejestracyjną w ramce
                    </Text>
                </View>

                {/* Centered scan frame */}
                <View style={styles.middleSection}>
                    <View style={styles.scanFrame}>
                        <View style={[styles.corner, styles.topLeft]} />
                        <View style={[styles.corner, styles.topRight]} />
                        <View style={[styles.corner, styles.bottomLeft]} />
                        <View style={[styles.corner, styles.bottomRight]} />

                        {/* Scanning indicator inside frame */}
                        {isScanning && isProcessing && (
                            <View style={styles.scanningIndicator}>
                                <ActivityIndicator color="#3B82F6" size="small" />
                            </View>
                        )}
                    </View>
                </View>

                {/* Status and controls at bottom */}
                <View style={styles.bottomSection}>
                    {/* Status message */}
                    <View style={styles.statusContainer}>
                        <Text style={styles.statusText}>{statusMessage}</Text>
                    </View>

                    {/* Main scan button */}
                    <TouchableOpacity
                        style={[
                            styles.scanButton,
                            isScanning && styles.scanButtonActive,
                        ]}
                        onPress={toggleScanning}>
                        <Text style={styles.scanButtonText}>
                            {isScanning ? 'STOP' : 'SKANUJ'}
                        </Text>
                    </TouchableOpacity>

                    {/* Navigation buttons */}
                    <View style={styles.navContainer}>
                        <TouchableOpacity
                            style={styles.navButton}
                            onPress={() => navigation.navigate('ManualEntry')}>
                            <Text style={styles.navButtonText}>✏️ Ręcznie</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.navButton}
                            onPress={() => navigation.navigate('History')}>
                            <Text style={styles.navButtonText}>📋 Historia</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000000',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'space-between',
    },
    topSection: {
        paddingTop: 60,
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    instructionText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '500',
        textAlign: 'center',
        textShadowColor: 'rgba(0, 0, 0, 0.8)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    middleSection: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scanFrame: {
        width: SCAN_FRAME_WIDTH,
        height: SCAN_FRAME_HEIGHT,
        borderWidth: 2,
        borderColor: 'rgba(59, 130, 246, 0.5)',
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    corner: {
        position: 'absolute',
        width: 24,
        height: 24,
        borderColor: '#3B82F6',
        borderWidth: 3,
    },
    topLeft: {
        top: -2,
        left: -2,
        borderRightWidth: 0,
        borderBottomWidth: 0,
        borderTopLeftRadius: 8,
    },
    topRight: {
        top: -2,
        right: -2,
        borderLeftWidth: 0,
        borderBottomWidth: 0,
        borderTopRightRadius: 8,
    },
    bottomLeft: {
        bottom: -2,
        left: -2,
        borderRightWidth: 0,
        borderTopWidth: 0,
        borderBottomLeftRadius: 8,
    },
    bottomRight: {
        bottom: -2,
        right: -2,
        borderLeftWidth: 0,
        borderTopWidth: 0,
        borderBottomRightRadius: 8,
    },
    scanningIndicator: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderRadius: 20,
        padding: 8,
    },
    bottomSection: {
        paddingBottom: 40,
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    statusContainer: {
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
        marginBottom: 20,
    },
    statusText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
    },
    scanButton: {
        backgroundColor: '#3B82F6',
        paddingHorizontal: 60,
        paddingVertical: 18,
        borderRadius: 30,
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 5,
        marginBottom: 20,
    },
    scanButtonActive: {
        backgroundColor: '#EF4444',
        shadowColor: '#EF4444',
    },
    scanButtonText: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '700',
        letterSpacing: 2,
    },
    navContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 16,
    },
    navButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.15)',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.25)',
    },
    navButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '600',
    },
    permissionContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
        backgroundColor: '#1A1A1A',
    },
    permissionTitle: {
        fontSize: 22,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 16,
        textAlign: 'center',
    },
    permissionText: {
        fontSize: 16,
        color: '#9CA3AF',
        textAlign: 'center',
        marginBottom: 32,
        lineHeight: 24,
    },
    permissionButton: {
        backgroundColor: '#3B82F6',
        paddingHorizontal: 32,
        paddingVertical: 14,
        borderRadius: 10,
    },
    permissionButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 18,
        textAlign: 'center',
    },
});

export default HomeScreen;
