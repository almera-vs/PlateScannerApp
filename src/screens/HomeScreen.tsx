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
    Image,
} from 'react-native';
import {
    Camera,
    useCameraDevice,
    useCameraPermission,
    PhotoFile,
} from 'react-native-vision-camera';
import TextRecognition, { TextBlock } from '@react-native-ml-kit/text-recognition';
import RNFS from 'react-native-fs';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

import db from '../services/db';
import { RootStackParamList } from '../types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// Guide Box Dimensions (Centering)
const GUIDE_BOX_WIDTH_PERCENT = 0.8; // 80%
const GUIDE_BOX_HEIGHT = 150;
const GUIDE_BOX_WIDTH = SCREEN_WIDTH * GUIDE_BOX_WIDTH_PERCENT;

// Explicit regex for license plate validation (Offline Mode)
// Relaxed to 3-15 characters as requested
const STRICT_PLATE_REGEX = /^[A-Z0-9]{3,15}$/;

// Interval for "Snapshot" loop
const SNAPSHOT_INTERVAL_MS = 2000;

export const HomeScreen: React.FC = () => {
    const navigation = useNavigation<NavigationProp>();
    const { hasPermission, requestPermission } = useCameraPermission();
    const device = useCameraDevice('back');
    const camera = useRef<Camera>(null);
    const isFocused = useIsFocused();

    const [isScanning, setIsScanning] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string>('Naciśnij SKANUJ aby rozpocząć');
    const [lastScannedPlate, setLastScannedPlate] = useState<string | null>(null);

    useEffect(() => {
        // Initialize DB
        try {
            db.initDB();
        } catch (e) {
            console.error('DB Init Error', e);
        }
    }, []);

    const handlePlateDetected = useCallback(
        async (plateNumber: string) => {
            // Normalize: Remove spaces for DB check/save depending on requirement
            const dbPlate = plateNumber.replace(/\s/g, '');

            if (dbPlate === lastScannedPlate) return;

            setLastScannedPlate(dbPlate);
            setIsScanning(false); // Stop loop
            setStatusMessage(`Wykryto: ${plateNumber}`);

            try {
                const checkResult = db.checkPlate(dbPlate);

                if (checkResult.exists && checkResult.plate) {
                    const scanDate = format(
                        new Date(checkResult.plate.scan_date),
                        'dd.MM.yyyy HH:mm',
                        { locale: pl },
                    );
                    Alert.alert(
                        '⚠️ DUPLIKAT!',
                        `Tablica ${plateNumber} już istnieje.\nZgłoszony: ${scanDate}`,
                        [
                            {
                                text: 'Anuluj',
                                style: 'cancel',
                                onPress: () => {
                                    setLastScannedPlate(null);
                                    setStatusMessage('Naciśnij SKANUJ aby kontynuować');
                                }
                            },
                            {
                                text: 'Zgłoś ponownie',
                                style: 'default',
                                onPress: () => {
                                    // FORCE UPDATE
                                    db.addPlate(dbPlate, false, true);
                                    Alert.alert('✅ ZAKTUALIZOWANO', 'Zwiększono licznik zgłoszeń.', [{
                                        text: 'OK',
                                        onPress: () => {
                                            setLastScannedPlate(null);
                                            setStatusMessage('Gotowy.');
                                        }
                                    }]);
                                }
                            }
                        ],
                        { cancelable: false }
                    );
                } else {
                    Alert.alert(
                        '🚗 Nowa tablica',
                        `Wykryto: ${plateNumber}\nCzy zgłosić?`,
                        [
                            {
                                text: 'Anuluj',
                                style: 'cancel',
                                onPress: () => {
                                    setLastScannedPlate(null);
                                    setStatusMessage('Anulowano.');
                                }
                            },
                            {
                                text: 'Zgłoś',
                                onPress: () => {
                                    db.addPlate(dbPlate, false);
                                    Alert.alert('✅ ZAPISANO', 'Dodano do bazy.', [{
                                        text: 'OK',
                                        onPress: () => {
                                            setLastScannedPlate(null);
                                            setStatusMessage('Gotowy.');
                                        }
                                    }]);
                                },
                            },
                        ],
                        { cancelable: false },
                    );
                }
            } catch (err) {
                console.error('DB Error', err);
                setStatusMessage('Błąd bazy danych');
            }
        },
        [lastScannedPlate],
    );

    const captureAndProcess = useCallback(async () => {
        if (!camera.current || !isScanning || isProcessing) return;

        setIsProcessing(true);
        setStatusMessage('Przetwarzanie...');

        let originalPhotoPath: string | null = null;

        try {
            // A) Snapshot
            const photo = await camera.current.takePhoto({
                flash: 'off',
                enableShutterSound: false,
            });
            originalPhotoPath = photo.path;

            // B) OCR on Full Image
            const result = await TextRecognition.recognize(`file://${originalPhotoPath}`);

            // C) ROI Filtering (Logical Crop)
            // Filter text blocks based on their position in the image
            // We want blocks that are roughly in the center (where the Guide Box is)
            const imgW = photo.width;
            const imgH = photo.height;

            // Guide Box logic:
            // Width: 80% centered -> 10% from left to 90% from left
            // Height: Fixed 150px at center. On screen, 150px is a fraction of SCREEN_HEIGHT.
            // We should map this fraction to image height.
            const guideBoxScreenFractionH = GUIDE_BOX_HEIGHT / SCREEN_HEIGHT;
            // To be safe, let's use a slightly larger vertical area (e.g. 20% or 30%)
            const ROI_H_PERCENT = Math.max(0.2, guideBoxScreenFractionH * 1.5);

            const MIN_Y = imgH * (0.5 - ROI_H_PERCENT / 2);
            const MAX_Y = imgH * (0.5 + ROI_H_PERCENT / 2);
            const MIN_X = imgW * 0.05; // Ignore very edges
            const MAX_X = imgW * 0.95;

            let foundPlate: string | null = null;

            for (const block of result.blocks) {
                if (!block.frame) continue;

                const frame: any = block.frame;
                const x = frame.x ?? frame.left ?? 0;
                const y = frame.y ?? frame.top ?? 0;
                const w = frame.width;
                const h = frame.height;

                const midX = x + w / 2;
                const midY = y + h / 2;

                // Check if center of block is inside ROI
                const isInside = midY > MIN_Y && midY < MAX_Y && midX > MIN_X && midX < MAX_X;

                if (!isInside) {
                    // Logically cropped out
                    continue;
                }

                // D) Regex Check
                const text = block.text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
                if (STRICT_PLATE_REGEX.test(text)) {
                    foundPlate = text;
                    break;
                }
            }

            // If not found in blocks, try specific words in ROI (if needed) - Keeping simple for now

            if (foundPlate) {
                await handlePlateDetected(foundPlate);
            } else {
                // Continue scanning
                setStatusMessage('Skanowanie...');
            }

        } catch (err) {
            console.error('Capture Error', err);
            setStatusMessage('Błąd kamery');
        } finally {
            setIsProcessing(false);

            // Cleanup original photo
            if (originalPhotoPath) {
                RNFS.unlink(originalPhotoPath).catch(() => { });
            }
        }
    }, [camera, isScanning, isProcessing, handlePlateDetected]);

    // Interval Loop
    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (isScanning && !isProcessing && isFocused && hasPermission) {
            interval = setInterval(() => {
                captureAndProcess();
            }, SNAPSHOT_INTERVAL_MS);
        }
        return () => clearInterval(interval);
    }, [isScanning, isProcessing, isFocused, hasPermission, captureAndProcess]);


    const toggleScanning = () => {
        setIsScanning(!isScanning);
        if (!isScanning) {
            setLastScannedPlate(null);
            setStatusMessage('Przygotowanie...');
        } else {
            setStatusMessage('Zatrzymano');
        }
    };

    if (!device || !hasPermission) {
        return (
            <View style={styles.container}>
                <Text style={{ color: 'white', marginTop: 100, textAlign: 'center' }}>
                    Brak dostępu do kamery
                </Text>
                <TouchableOpacity onPress={requestPermission} style={styles.permButton}>
                    <Text>Nadaj Uprawnienia</Text>
                </TouchableOpacity>
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
                zoom={device.neutralZoom ? device.neutralZoom * 2 : 2.0}
            />

            <View style={styles.overlay}>

                {/* Top: Instructions */}
                <View style={styles.topBar}>
                    <Text style={styles.titleText}>SPRAWDŹ TABLICE</Text>
                    <Text style={styles.subText}>Umieść tablicę w ramce</Text>
                </View>

                {/* Center: Guide Box */}
                <View style={styles.centerArea}>
                    <View style={styles.guideBox}>
                        {/* Corners */}
                        <View style={[styles.corner, styles.tl]} />
                        <View style={[styles.corner, styles.tr]} />
                        <View style={[styles.corner, styles.bl]} />
                        <View style={[styles.corner, styles.br]} />

                        {isProcessing && (
                            <ActivityIndicator size="large" color="#fff" style={styles.loader} />
                        )}
                    </View>
                </View>

                {/* Bottom: Controls */}
                <View style={styles.bottomBar}>
                    <Text style={styles.statusText}>{statusMessage}</Text>

                    <TouchableOpacity
                        style={[styles.scanBtn, isScanning ? styles.stopBtn : styles.startBtn]}
                        onPress={toggleScanning}
                    >
                        <Text style={styles.scanBtnText}>
                            {isScanning ? 'STOP' : 'SKANUJ'}
                        </Text>
                    </TouchableOpacity>

                    <View style={styles.navRow}>
                        <TouchableOpacity onPress={() => navigation.navigate('ManualEntry')} style={styles.smallBtn}>
                            <Text style={styles.smallBtnText}>Ręcznie</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => navigation.navigate('History')} style={styles.smallBtn}>
                            <Text style={styles.smallBtnText}>Historia</Text>
                        </TouchableOpacity>
                    </View>
                </View>

            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'black' },
    overlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },

    topBar: {
        paddingTop: 60,
        alignItems: 'center',
    },
    titleText: { color: 'white', fontSize: 24, fontWeight: 'bold', letterSpacing: 2 },
    subText: { color: '#ccc', fontSize: 14, marginTop: 5 },

    centerArea: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    guideBox: {
        width: GUIDE_BOX_WIDTH,
        height: GUIDE_BOX_HEIGHT,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.3)',
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    corner: {
        position: 'absolute',
        width: 20,
        height: 20,
        borderColor: '#00D1FF', // Cyan accent
        borderWidth: 3,
    },
    tl: { top: -2, left: -2, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 10 },
    tr: { top: -2, right: -2, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 10 },
    bl: { bottom: -2, left: -2, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 10 },
    br: { bottom: -2, right: -2, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 10 },
    loader: { transform: [{ scale: 1.5 }] },

    bottomBar: {
        paddingBottom: 40,
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.4)',
        paddingTop: 20,
    },
    statusText: {
        color: 'white',
        marginBottom: 20,
        fontSize: 16,
        fontWeight: '600',
    },
    scanBtn: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 4,
        borderColor: 'white',
        marginBottom: 20,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
        elevation: 5,
    },
    startBtn: { backgroundColor: '#3B82F6' }, // Blue
    stopBtn: { backgroundColor: '#EF4444' }, // Red
    scanBtnText: { color: 'white', fontWeight: 'bold', fontSize: 12 },

    navRow: {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-evenly',
    },
    smallBtn: {
        padding: 10,
    },
    smallBtnText: {
        color: '#ccc',
        fontSize: 16,
    },
    permButton: { backgroundColor: '#333', padding: 20, marginTop: 20, borderRadius: 8 }
});

export default HomeScreen;
