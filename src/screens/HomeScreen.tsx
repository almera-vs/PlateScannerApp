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
import TextRecognition from '@react-native-ml-kit/text-recognition';
import ImageEditor from '@react-native-community/image-editor';
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
const STRICT_PLATE_REGEX = /^[A-Z]{2,3}\s?[0-9A-Z]{4,5}$/;

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
            // Display format: Keep spaces if regex matched with spaces? 
            // User regex: /^[A-Z]{2,3}\s?[0-9A-Z]{4,5}$/ (optional space)
            // Let's normalize to no-space for DB consistency
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
                        [{
                            text: 'OK', onPress: () => {
                                setLastScannedPlate(null);
                                setStatusMessage('Naciśnij SKANUJ aby kontynuować');
                            }
                        }],
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

    const captureAndCrop = useCallback(async () => {
        if (!camera.current || !isScanning || isProcessing) return;

        setIsProcessing(true);
        setStatusMessage('Przetwarzanie...');

        let originalPhotoPath: string | null = null;
        let croppedPhotoPath: string | null = null;

        try {
            // A) Snapshot
            const photo = await camera.current.takePhoto({
                flash: 'off',
                enableShutterSound: false, // Try to silence if possible
            });
            originalPhotoPath = photo.path;

            // B) Calculate Crop
            // We want the center area corresponding to the Guide Box
            // Guide Box is vertically centered, height = 150
            // Guide Box is horizontally centered, width = 80%

            // Image coords
            const imgW = photo.width;
            const imgH = photo.height;

            // Calculate crop region (normalized to image dimensions)
            // Vertical center:
            // The Guide Box UI is at screen center.
            // We assume the camera preview fills the screen (cover).
            // So the crop area relative to image is proportional to GuideBox relative to Screen.

            // NOTE: Handling aspect ratio differences between Screen and Camera Sensor is complex.
            // For simplicity, we implement the User's formula: "offset_y = height * 0.4", "height = 0.2"
            // User Formula:
            // offset_x = imageWidth * 0.1 (to match 80% width centered)
            // crop_width = imageWidth * 0.8
            // offset_y = imageHeight * 0.4 (approx middle)
            // crop_height = imageHeight * 0.2

            const cropData = {
                offset: {
                    x: imgW * ((1 - GUIDE_BOX_WIDTH_PERCENT) / 2), // 10% from left
                    y: imgH * 0.4, // Start at 40% height
                },
                size: {
                    width: imgW * GUIDE_BOX_WIDTH_PERCENT, // 80% width
                    height: imgH * 0.2, // 20% height
                },
                displaySize: {
                    width: imgW * GUIDE_BOX_WIDTH_PERCENT,
                    height: imgH * 0.2
                },
                resizeMode: 'contain' as const,
            };

            // C) Crop
            const resultObj = await ImageEditor.cropImage(`file://${originalPhotoPath}`, cropData);
            // ImageEditor returns { path: string, width: number, height: number } or similar depending on version
            // Checking type defs or docs: It returns Promise<CropResult> which has 'path' or 'uri'
            // If resultObj is string (some versions), use it. If object, use .path or .uri
            const uri = (typeof resultObj === 'string') ? resultObj : (resultObj as any).path ?? (resultObj as any).uri;
            croppedPhotoPath = uri;

            // D) OCR on Cropped Image
            const result = await TextRecognition.recognize(uri);

            // E) Filter
            let foundPlate: string | null = null;

            // Check full blocks first
            for (const block of result.blocks) {
                const text = block.text.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); // Basic normalization
                // Check strict regex
                // We need to re-verify regex logic. 
                // If regex allows space /^[A-Z]{2,3}\s?[0-9A-Z]{4,5}$/
                // Then we shouldn't strip space in temp text completely if we want to match exact regex
                // But usually trimming non-alphanumeric is safer for noisy OCR.
                // Let's strip special chars but try to match the pattern structure A-Z then 0-9

                if (STRICT_PLATE_REGEX.test(text)) {
                    foundPlate = text;
                    break;
                }
            }

            // If not found in blocks, try line by line
            if (!foundPlate) {
                // Flatten all text
                const allText = result.text.toUpperCase().replace(/[^A-Z0-9\s]/g, '');
                const words = allText.split(/\s+/);
                for (const w of words) {
                    if (STRICT_PLATE_REGEX.test(w)) {
                        foundPlate = w;
                        break;
                    }
                }
            }

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

            // Cleanup
            if (croppedPhotoPath) {
                RNFS.unlink(croppedPhotoPath).catch(() => { });
            }
            // Note: originalPhotoPath is managed by Camera lib (cache), usually cleaned up by OS eventually,
            // but we can delete it if we want to be strict.
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
                captureAndCrop();
            }, SNAPSHOT_INTERVAL_MS);
        }
        return () => clearInterval(interval);
    }, [isScanning, isProcessing, isFocused, hasPermission, captureAndCrop]);


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
                // Use user requested zoom strategy: Neutral * 2 or just 2.0
                // "set the default zoom property to 2.0 (or device.neutralZoom * 2)" from Prompt 1
                // Prompt 2: "device.neutralZoom * 3"
                // Prompt 3 (this one): "Refactor... logic". Doesn't explicitly mention zoom change, but implies standard setup.
                // I will keep 2.0 or 3.0. Let's stick to 2.0 for "Guide Box" strategy (snapshot usually high res).
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
