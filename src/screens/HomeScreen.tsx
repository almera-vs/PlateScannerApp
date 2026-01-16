import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    Linking,
    ActivityIndicator,
} from 'react-native';
import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    PhotoFile,
} from 'react-native-vision-camera';
import TextRecognition from 'react-native-text-recognition';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

import db from '../services/db';
import { RootStackParamList } from '../types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

// License plate regex pattern (5-8 alphanumeric characters, allows Polish plates)
const PLATE_REGEX = /^[A-Z0-9]{5,8}$/;

// Minimum interval between scans in ms
const SCAN_DEBOUNCE_MS = 1500;

export const HomeScreen: React.FC = () => {
    const navigation = useNavigation<NavigationProp>();
    const { hasPermission, requestPermission } = useCameraPermission();
    const device = useCameraDevice('back');
    const camera = useRef<Camera>(null);
    const isFocused = useIsFocused();

    const [isScanning, setIsScanning] = useState(false);
    const [lastScanTime, setLastScanTime] = useState(0);
    const [scanResult, setScanResult] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        // Initialize database on component mount
        db.initDB().catch(error => {
            console.error('Failed to initialize DB:', error);
            Alert.alert('Błąd', 'Nie udało się zainicjować bazy danych');
        });
    }, []);

    const validatePlate = useCallback((text: string): string | null => {
        // Normalize: uppercase, remove spaces and special chars
        const normalized = text.toUpperCase().replace(/[^A-Z0-9]/g, '');

        if (PLATE_REGEX.test(normalized)) {
            return normalized;
        }
        return null;
    }, []);

    const processRecognizedText = useCallback(
        async (recognizedTexts: string[]) => {
            // Find valid plates from recognized text blocks
            for (const text of recognizedTexts) {
                // Split text by whitespace and check each word
                const words = text.split(/\s+/);
                for (const word of words) {
                    const validPlate = validatePlate(word);
                    if (validPlate) {
                        return validPlate;
                    }
                }
            }
            return null;
        },
        [validatePlate],
    );

    const handleCapture = useCallback(async () => {
        const now = Date.now();

        // Debounce check
        if (now - lastScanTime < SCAN_DEBOUNCE_MS) {
            return;
        }

        if (!camera.current || isProcessing) {
            return;
        }

        setIsProcessing(true);
        setLastScanTime(now);

        try {
            // Take photo
            const photo: PhotoFile = await camera.current.takePhoto({
                flash: 'off',
            });

            // Perform OCR
            const recognizedTexts = await TextRecognition.recognize(
                `file://${photo.path}`,
            );

            // Find valid plate
            const plateNumber = await processRecognizedText(recognizedTexts);

            if (plateNumber) {
                setScanResult(plateNumber);
                setIsScanning(false);

                // Check if plate exists in database
                const checkResult = await db.checkPlate(plateNumber);

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
                                    setScanResult(null);
                                    setIsScanning(true);
                                },
                            },
                        ],
                        { cancelable: false },
                    );
                } else {
                    // NEW PLATE - Save and show GREEN alert
                    const savedPlate = await db.addPlate(plateNumber, false);

                    if (savedPlate) {
                        Alert.alert(
                            '✅ ZAPISANO',
                            `Tablica ${plateNumber} została zapisana.`,
                            [
                                {
                                    text: 'OK',
                                    onPress: () => {
                                        setScanResult(null);
                                        setIsScanning(true);
                                    },
                                },
                            ],
                            { cancelable: false },
                        );
                    } else {
                        Alert.alert('Błąd', 'Nie udało się zapisać tablicy.');
                        setScanResult(null);
                        setIsScanning(true);
                    }
                }
            }
        } catch (error) {
            console.error('Capture/OCR error:', error);
        } finally {
            setIsProcessing(false);
        }
    }, [lastScanTime, isProcessing, processRecognizedText]);

    // Auto-capture when scanning is active
    useEffect(() => {
        let interval: ReturnType<typeof setInterval> | null = null;

        if (isScanning && isFocused && device && hasPermission) {
            interval = setInterval(() => {
                handleCapture();
            }, 1000); // Attempt capture every second
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isScanning, isFocused, device, hasPermission, handleCapture]);

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
                {/* Scan frame */}
                <View style={styles.scanFrame}>
                    <View style={[styles.corner, styles.topLeft]} />
                    <View style={[styles.corner, styles.topRight]} />
                    <View style={[styles.corner, styles.bottomLeft]} />
                    <View style={[styles.corner, styles.bottomRight]} />
                </View>

                {/* Status */}
                <View style={styles.statusContainer}>
                    {isProcessing && (
                        <View style={styles.processingBadge}>
                            <ActivityIndicator color="#FFFFFF" size="small" />
                            <Text style={styles.processingText}>Przetwarzanie...</Text>
                        </View>
                    )}

                    {scanResult && (
                        <View style={styles.resultBadge}>
                            <Text style={styles.resultText}>{scanResult}</Text>
                        </View>
                    )}

                    {isScanning && !isProcessing && (
                        <Text style={styles.scanningText}>
                            Skieruj kamerę na tablicę rejestracyjną
                        </Text>
                    )}
                </View>

                {/* Controls */}
                <View style={styles.controlsContainer}>
                    <TouchableOpacity
                        style={[
                            styles.scanButton,
                            isScanning && styles.scanButtonActive,
                        ]}
                        onPress={() => setIsScanning(!isScanning)}>
                        <Text style={styles.scanButtonText}>
                            {isScanning ? 'STOP' : 'SKANUJ'}
                        </Text>
                    </TouchableOpacity>
                </View>

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
        paddingVertical: 60,
    },
    scanFrame: {
        alignSelf: 'center',
        width: 300,
        height: 100,
        marginTop: 100,
    },
    corner: {
        position: 'absolute',
        width: 30,
        height: 30,
        borderColor: '#3B82F6',
        borderWidth: 4,
    },
    topLeft: {
        top: 0,
        left: 0,
        borderRightWidth: 0,
        borderBottomWidth: 0,
    },
    topRight: {
        top: 0,
        right: 0,
        borderLeftWidth: 0,
        borderBottomWidth: 0,
    },
    bottomLeft: {
        bottom: 0,
        left: 0,
        borderRightWidth: 0,
        borderTopWidth: 0,
    },
    bottomRight: {
        bottom: 0,
        right: 0,
        borderLeftWidth: 0,
        borderTopWidth: 0,
    },
    statusContainer: {
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    processingBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(59, 130, 246, 0.9)',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
    },
    processingText: {
        color: '#FFFFFF',
        marginLeft: 10,
        fontSize: 14,
        fontWeight: '600',
    },
    resultBadge: {
        backgroundColor: 'rgba(16, 185, 129, 0.9)',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    resultText: {
        color: '#FFFFFF',
        fontSize: 24,
        fontWeight: '700',
        letterSpacing: 3,
    },
    scanningText: {
        color: '#FFFFFF',
        fontSize: 16,
        textAlign: 'center',
        textShadowColor: 'rgba(0, 0, 0, 0.7)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    controlsContainer: {
        alignItems: 'center',
    },
    scanButton: {
        backgroundColor: '#3B82F6',
        paddingHorizontal: 48,
        paddingVertical: 16,
        borderRadius: 30,
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 8,
        elevation: 5,
    },
    scanButtonActive: {
        backgroundColor: '#EF4444',
        shadowColor: '#EF4444',
    },
    scanButtonText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        letterSpacing: 2,
    },
    navContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 20,
        paddingBottom: 20,
    },
    navButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    navButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
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
