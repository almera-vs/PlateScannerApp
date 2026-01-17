import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    RefreshControl,
    Alert,
    TouchableOpacity,
    Platform,
    Share,
    Modal,
    TextInput,
    KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import DocumentPicker from 'react-native-document-picker';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

import db from '../services/db';
import { Plate } from '../types';
import PlateItem from '../components/PlateItem';

// Helper to parse "PLATE | DATE | TYPE" format
const parseImportData = (text: string): { plate: string; isManual: boolean }[] => {
    const lines = text.split('\n');
    const parsed: { plate: string; isManual: boolean }[] = [];

    lines.forEach(line => {
        if (!line.trim()) return;
        // Expected format: "PLATE | dd.MM.yyyy HH:mm | Type"
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 3) {
            const plate = parts[0].replace(/\s/g, ''); // Remove internal spaces just in case
            // date is parts[1], but we just re-save it as new or keep original date? 
            // DB schema automatically sets scan_date to NOW if not provided.
            // Requirement: "Import... using the same data that exporting does"
            // If we want to preserve DATE, we need to modify addPlate to accept date, or just add as new.
            // For simplicity, we import them as new entries (or checking duplicates).
            // Actually, best to just extract the PLATE number.
            const typeStr = parts[2].toLowerCase();
            const isManual = typeStr.includes('ręcznie') || typeStr.includes('manual');

            if (plate.length >= 3) {
                parsed.push({ plate, isManual });
            }
        }
    });
    return parsed;
};

export const HistoryScreen: React.FC = () => {
    const [plates, setPlates] = useState<Plate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Import Modal State
    const [importModalVisible, setImportModalVisible] = useState(false);
    const [pasteContent, setPasteContent] = useState('');

    const loadPlates = useCallback(async () => {
        try {
            await db.initDB();
            const allPlates = await db.getAllPlates();
            setPlates(allPlates);
        } catch (error) {
            console.error('Failed to load plates:', error);
            Alert.alert('Błąd', 'Nie udało się załadować historii');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useFocusEffect(useCallback(() => { loadPlates(); }, [loadPlates]));

    const handleRefresh = useCallback(() => {
        setIsRefreshing(true);
        loadPlates();
    }, [loadPlates]);

    const formatPlatesData = () => {
        return plates
            .map(p => {
                const date = format(new Date(p.scan_date), 'dd.MM.yyyy HH:mm', { locale: pl });
                return `${p.plate_number} | ${date} | ${p.is_manual ? 'Ręcznie' : 'Skan'}`;
            })
            .join('\n');
    };

    // --- Export Logic ---
    const handleShareData = async () => {
        if (plates.length === 0) {
            Alert.alert('Pusto', 'Brak danych do udostępnienia');
            return;
        }
        try {
            await Share.share({
                message: formatPlatesData(),
                title: 'Historia sprawdzonych tablic'
            });
        } catch (error) {
            Alert.alert('Błąd', 'Nie udało się udostępnić danych');
        }
    };

    const handleExportFile = async () => {
        if (plates.length === 0) {
            Alert.alert('Pusto', 'Brak danych do eksportu');
            return;
        }

        const data = formatPlatesData();
        const fileName = `tablice_export_${Date.now()}.txt`;
        const path = `${RNFS.DocumentDirectoryPath}/${fileName}`;

        try {
            await RNFS.writeFile(path, data, 'utf8');

            // Share the FILE url so user can save it to Files/Drive/Etc
            await Share.share({
                url: `file://${path}`,
                title: 'Eksportuj plik .txt',
                message: 'Zapisz plik z historią'
            });

        } catch (error) {
            console.error('Export error:', error);
            Alert.alert('Błąd', 'Nie udało się utworzyć pliku.');
        }
    };


    // --- Import Logic ---
    const processImportedData = async (text: string) => {
        const parsed = parseImportData(text);
        if (parsed.length === 0) {
            Alert.alert('Błąd', 'Nie znaleziono poprawnych danych w tekście.');
            return;
        }

        let addedCount = 0;
        let duplicateCount = 0;

        try {
            for (const item of parsed) {
                const check = await db.checkPlate(item.plate);
                if (!check.exists) {
                    await db.addPlate(item.plate, item.isManual);
                    addedCount++;
                } else {
                    duplicateCount++;
                }
            }

            loadPlates(); // Refresh list
            Alert.alert(
                'Import Zakończony',
                `Dodano: ${addedCount}\nDuplikaty: ${duplicateCount}`,
                [{ text: 'OK' }]
            );
            setImportModalVisible(false);
            setPasteContent('');

        } catch (e) {
            console.error(e);
            Alert.alert('Błąd', 'Wystąpił błąd podczas importu.');
        }
    };

    const handleImportFile = async () => {
        try {
            const res = await DocumentPicker.pick({
                type: [DocumentPicker.types.plainText],
            });

            if (res[0]) {
                const fileUri = res[0].uri;
                const content = await RNFS.readFile(fileUri, 'utf8');

                Alert.alert(
                    'Potwierdź import',
                    `Czy dodać dane z pliku ${res[0].name}?`,
                    [
                        { text: 'Anuluj', style: 'cancel' },
                        { text: 'Importuj', onPress: () => processImportedData(content) }
                    ]
                );
            }
        } catch (err) {
            if (!DocumentPicker.isCancel(err)) {
                Alert.alert('Błąd', 'Nie udało się wybrać pliku');
            }
        }
    };

    const handleImportPaste = () => {
        setImportModalVisible(true);
    };


    const handleDelete = useCallback(async (id: number) => {
        Alert.alert(
            'Potwierdź usunięcie',
            'Czy na pewno chcesz usunąć ten wpis?',
            [
                { text: 'Anuluj', style: 'cancel' },
                {
                    text: 'Usuń',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await db.deletePlate(id);
                            setPlates(prev => prev.filter(plate => plate.id !== id));
                        } catch (error) {
                            Alert.alert('Błąd', 'Nie udało się usunąć wpisu');
                        }
                    },
                },
            ],
        );
    }, []);

    const renderItem = useCallback(({ item }: { item: Plate }) => <PlateItem plate={item} onDelete={handleDelete} />, [handleDelete]);
    const keyExtractor = useCallback((item: Plate) => item.id.toString(), []);

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Ładowanie...</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Historia</Text>
                <Text style={styles.headerSubtitle}>
                    {plates.length} {plates.length === 1 ? 'tablica' : 'tablic'}
                </Text>

                <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.actionBtn} onPress={handleShareData}>
                        <Text style={styles.actionBtnText}>📤 Udostępnij</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.actionBtn, styles.exportBtn]} onPress={handleExportFile}>
                        <Text style={styles.actionBtnText}>💾 Zapisz plik</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.actionRow}>
                    <TouchableOpacity style={[styles.actionBtn, styles.importBtn]} onPress={handleImportFile}>
                        <Text style={styles.actionBtnText}>📂 Import (Plik)</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.actionBtn, styles.importBtn]} onPress={handleImportPaste}>
                        <Text style={styles.actionBtnText}>📂 Import (Wklej)</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <FlatList
                data={plates}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                contentContainerStyle={plates.length === 0 ? styles.emptyListContainer : styles.listContent}
                ListEmptyComponent={(
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyIcon}>📋</Text>
                        <Text style={styles.emptyTitle}>Brak zapisanych tablic</Text>
                        <Text style={styles.emptySubtitle}>Zeskanuj lub importuj tablice</Text>
                    </View>
                )}
                refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#3B82F6" colors={['#3B82F6']} />
                }
                showsVerticalScrollIndicator={false}
            />

            {/* Paste Import Modal */}
            <Modal
                animationType="slide"
                transparent={true}
                visible={importModalVisible}
                onRequestClose={() => setImportModalVisible(false)}
            >
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalOverlay}>
                    <View style={styles.modalView}>
                        <Text style={styles.modalTitle}>Wklej dane do importu</Text>
                        <Text style={styles.modalSub}>Format: TABLICA | Data | Typ</Text>

                        <TextInput
                            style={styles.modalInput}
                            multiline
                            placeholder="Wklej tekst tutaj..."
                            placeholderTextColor="#666"
                            value={pasteContent}
                            onChangeText={setPasteContent}
                        />

                        <View style={styles.modalButtons}>
                            <TouchableOpacity
                                style={[styles.modalBtn, styles.cancelBtn]}
                                onPress={() => setImportModalVisible(false)}
                            >
                                <Text style={styles.cancelBtnText}>Anuluj</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.modalBtn, styles.confirmBtn]}
                                onPress={() => processImportedData(pasteContent)}
                            >
                                <Text style={styles.confirmBtnText}>Importuj</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#F3F4F6' },
    header: { backgroundColor: '#1A1A1A', paddingTop: 20, paddingBottom: 20, paddingHorizontal: 20 },
    headerTitle: { fontSize: 32, fontWeight: '700', color: '#FFFFFF' },
    headerSubtitle: { fontSize: 16, color: '#9CA3AF', marginTop: 4 },

    actionRow: { flexDirection: 'row', marginTop: 12, gap: 10, flexWrap: 'wrap' },
    actionBtn: { backgroundColor: '#333', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#444' },
    exportBtn: { backgroundColor: '#3B82F6', borderColor: '#2563EB' },
    importBtn: { backgroundColor: '#10B981', borderColor: '#059669' },
    actionBtnText: { color: 'white', fontWeight: '600', fontSize: 13 },

    listContent: { paddingVertical: 12 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6' },
    loadingText: { fontSize: 18, color: '#6B7280' },
    emptyListContainer: { flex: 1, justifyContent: 'center' },
    emptyContainer: { alignItems: 'center', padding: 40 },
    emptyIcon: { fontSize: 64, marginBottom: 16 },
    emptyTitle: { fontSize: 20, fontWeight: '600', color: '#374151', marginBottom: 8 },
    emptySubtitle: { fontSize: 16, color: '#6B7280', textAlign: 'center', lineHeight: 24 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    modalView: { width: '90%', backgroundColor: 'white', borderRadius: 20, padding: 20, alignItems: 'center', elevation: 5 },
    modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 5, color: 'black' },
    modalSub: { fontSize: 12, color: '#666', marginBottom: 15 },
    modalInput: { width: '100%', height: 150, borderColor: '#ccc', borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 20, textAlignVertical: 'top', color: 'black' },
    modalButtons: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
    modalBtn: { borderRadius: 10, padding: 15, width: '45%', alignItems: 'center' },
    cancelBtn: { backgroundColor: '#ddd' },
    confirmBtn: { backgroundColor: '#3B82F6' },
    cancelBtnText: { fontWeight: 'bold', color: 'black' },
    confirmBtnText: { fontWeight: 'bold', color: 'white' }
});

export default HistoryScreen;
