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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import RNFS from 'react-native-fs';
import Clipboard from '@react-native-clipboard/clipboard';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

import db from '../services/db';
import { Plate } from '../types';
import PlateItem from '../components/PlateItem';

export const HistoryScreen: React.FC = () => {
    const [plates, setPlates] = useState<Plate[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

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

    // Reload data when screen gains focus
    useFocusEffect(
        useCallback(() => {
            loadPlates();
        }, [loadPlates]),
    );

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

    const handleCopyToClipboard = () => {
        if (plates.length === 0) {
            Alert.alert('Pusto', 'Brak danych do skopiowania');
            return;
        }

        const data = formatPlatesData();
        Clipboard.setString(data);
        Alert.alert('Skopiowano', 'Wszystkie tablice zostały skopiowane do schowka.');
    };

    const handleExportTxt = async () => {
        if (plates.length === 0) {
            Alert.alert('Pusto', 'Brak danych do eksportu');
            return;
        }

        const data = formatPlatesData();
        // Path: Documents folder or Download folder
        // On Android, Download is better for user visibility, but requires scoped storage permission sometimes.
        // Let's try ExternalDirectoryPath or DocumentDirectoryPath.
        // For simplicity and permission safety, use DocumentDirectoryPath (internal app storage visible to user if explicit)
        // OR ExternalDirectoryPath.

        // Let's try standard Documents path.
        const fileName = `tablice_export_${Date.now()}.txt`;
        const path = Platform.select({
            ios: `${RNFS.DocumentDirectoryPath}/${fileName}`,
            android: `${RNFS.ExternalDirectoryPath}/${fileName}`, // Usually /storage/emulated/0/Android/data/com.app/files/
        });

        if (!path) return;

        try {
            await RNFS.writeFile(path, data, 'utf8');
            Alert.alert(
                'Zapisano plik',
                `Plik został zapisany w:\n\n${path}`,
                [{ text: 'OK' }]
            );
        } catch (error) {
            console.error('Export error:', error);
            Alert.alert('Błąd', 'Nie udało się zapisać pliku.');
        }
    };

    const handleDelete = useCallback(
        async (id: number) => {
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
                                console.error('Failed to delete plate:', error);
                                Alert.alert('Błąd', 'Nie udało się usunąć wpisu');
                            }
                        },
                    },
                ],
            );
        },
        [],
    );

    const renderItem = useCallback(
        ({ item }: { item: Plate }) => <PlateItem plate={item} onDelete={handleDelete} />,
        [handleDelete],
    );

    const keyExtractor = useCallback((item: Plate) => item.id.toString(), []);

    const renderEmptyList = () => (
        <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>Brak zapisanych tablic</Text>
            <Text style={styles.emptySubtitle}>
                Zeskanuj lub wprowadź ręcznie tablicę rejestracyjną
            </Text>
        </View>
    );

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

                {/* Action Buttons Row */}
                <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.actionBtn} onPress={handleCopyToClipboard}>
                        <Text style={styles.actionBtnText}>📋 Kopiuj</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.actionBtn, styles.exportBtn]} onPress={handleExportTxt}>
                        <Text style={styles.actionBtnText}>💾 Eksportuj .txt</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <FlatList
                data={plates}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                contentContainerStyle={
                    plates.length === 0 ? styles.emptyListContainer : styles.listContent
                }
                ListEmptyComponent={renderEmptyList}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={handleRefresh}
                        tintColor="#3B82F6"
                        colors={['#3B82F6']}
                    />
                }
                showsVerticalScrollIndicator={false}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F3F4F6',
    },
    header: {
        backgroundColor: '#1A1A1A',
        paddingTop: 20,
        paddingBottom: 20,
        paddingHorizontal: 20,
    },
    headerTitle: {
        fontSize: 32,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    headerSubtitle: {
        fontSize: 16,
        color: '#9CA3AF',
        marginTop: 4,
    },
    actionRow: {
        flexDirection: 'row',
        marginTop: 16,
        gap: 12,
    },
    actionBtn: {
        backgroundColor: '#333',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#444',
    },
    exportBtn: {
        backgroundColor: '#3B82F6', // Blue for primary action
        borderColor: '#2563EB',
    },
    actionBtnText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
    listContent: {
        paddingVertical: 12,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
    },
    loadingText: {
        fontSize: 18,
        color: '#6B7280',
    },
    emptyListContainer: {
        flex: 1,
        justifyContent: 'center',
    },
    emptyContainer: {
        alignItems: 'center',
        padding: 40,
    },
    emptyIcon: {
        fontSize: 64,
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
    },
    emptySubtitle: {
        fontSize: 16,
        color: '#6B7280',
        textAlign: 'center',
        lineHeight: 24,
    },
});

export default HistoryScreen;
