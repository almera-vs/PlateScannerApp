import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    TouchableOpacity,
    Alert,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

import db from '../services/db';

// License plate regex pattern (3-15 alphanumeric characters)
const PLATE_REGEX = /^[A-Z0-9]{3,15}$/;

export const ManualEntryScreen: React.FC = () => {
    const navigation = useNavigation();
    const [plateNumber, setPlateNumber] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        try {
            db.initDB();
        } catch (err) {
            console.error('Failed to init DB:', err);
        }
    }, []);

    const normalizeInput = (text: string): string => {
        return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    };

    const handleInputChange = (text: string) => {
        const normalized = normalizeInput(text);
        setPlateNumber(normalized);
        setError(null);
    };

    const validatePlate = (text: string): boolean => {
        return PLATE_REGEX.test(text);
    };

    const handleSave = async () => {
        const normalizedPlate = plateNumber.trim();

        if (!normalizedPlate) {
            setError('Wprowadź numer tablicy rejestracyjnej');
            return;
        }

        if (!validatePlate(normalizedPlate)) {
            setError('Nieprawidłowy format tablicy (3-15 znaków alfanumerycznych)');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            // Check if plate already exists
            const checkResult = await db.checkPlate(normalizedPlate);

            if (checkResult.exists && checkResult.plate) {
                // DUPLICATE - Show RED alert
                const scanDate = format(
                    new Date(checkResult.plate.scan_date),
                    'dd.MM.yyyy HH:mm',
                    { locale: pl },
                );

                Alert.alert(
                    '⚠️ DUPLIKAT!',
                    `Tablica ${normalizedPlate} już istnieje w bazie.\n\nZgłoszony: ${scanDate}`,
                    [
                        { text: 'OK', style: 'cancel' },
                        {
                            text: 'Zgłoś ponownie',
                            onPress: async () => {
                                await db.addPlate(normalizedPlate, true, true);
                                Alert.alert('✅ ZAKTUALIZOWANO', 'Zwiększono licznik zgłoszeń.', [
                                    {
                                        text: 'OK',
                                        onPress: () => {
                                            setPlateNumber('');
                                            navigation.goBack();
                                        }
                                    }
                                ]);
                            }
                        }
                    ],
                );
            } else {
                // NEW PLATE - Save to database
                const savedPlate = await db.addPlate(normalizedPlate, true);

                if (savedPlate) {
                    Alert.alert(
                        '✅ ZAPISANO',
                        `Tablica ${normalizedPlate} została zapisana.`,
                        [
                            {
                                text: 'OK',
                                onPress: () => {
                                    setPlateNumber('');
                                    navigation.goBack();
                                },
                            },
                        ],
                    );
                } else {
                    setError('Nie udało się zapisać tablicy');
                }
            }
        } catch (err) {
            console.error('Save error:', err);
            setError('Wystąpił błąd podczas zapisywania');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View style={styles.content}>
                <Text style={styles.title}>Wprowadź tablicę ręcznie</Text>
                <Text style={styles.subtitle}>
                    Wpisz numer tablicy rejestracyjnej (max 15 znaków)
                </Text>

                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        value={plateNumber}
                        onChangeText={handleInputChange}
                        placeholder="NP. WZ12345"
                        placeholderTextColor="#9CA3AF"
                        maxLength={15}
                        autoCapitalize="characters"
                        autoCorrect={false}
                        autoComplete="off"
                        editable={!isLoading}
                    />
                </View>

                {error && <Text style={styles.errorText}>{error}</Text>}

                <TouchableOpacity
                    style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
                    onPress={handleSave}
                    disabled={isLoading}>
                    <Text style={styles.saveButtonText}>
                        {isLoading ? 'Zapisywanie...' : 'ZAPISZ'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => navigation.goBack()}
                    disabled={isLoading}>
                    <Text style={styles.cancelButtonText}>Anuluj</Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#1A1A1A',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        padding: 24,
    },
    title: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        textAlign: 'center',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#9CA3AF',
        textAlign: 'center',
        marginBottom: 40,
    },
    inputContainer: {
        backgroundColor: '#2D2D2D',
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#3B82F6',
        marginBottom: 16,
    },
    input: {
        fontSize: 28,
        fontWeight: '700',
        color: '#FFFFFF',
        textAlign: 'center',
        paddingVertical: 20,
        paddingHorizontal: 16,
        letterSpacing: 4,
    },
    errorText: {
        color: '#EF4444',
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 16,
    },
    saveButton: {
        backgroundColor: '#10B981',
        paddingVertical: 16,
        borderRadius: 12,
        marginBottom: 12,
        shadowColor: '#10B981',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
    },
    saveButtonDisabled: {
        backgroundColor: '#6B7280',
        shadowOpacity: 0,
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        textAlign: 'center',
        letterSpacing: 1,
    },
    cancelButton: {
        paddingVertical: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#4B5563',
    },
    cancelButtonText: {
        color: '#9CA3AF',
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
});

export default ManualEntryScreen;
