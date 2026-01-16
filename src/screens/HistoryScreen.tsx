import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    RefreshControl,
    Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

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
        paddingBottom: 24,
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
