import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { format } from 'date-fns';
import { Plate } from '../types';

interface PlateItemProps {
    plate: Plate;
    onDelete?: (id: number) => void;
}

export const PlateItem: React.FC<PlateItemProps> = ({ plate, onDelete }) => {
    const formattedDate = format(new Date(plate.scan_date), 'dd.MM.yyyy HH:mm');

    return (
        <View style={styles.container}>
            <View style={styles.plateContainer}>
                <Text style={styles.plateNumber}>{plate.plate_number}</Text>
                {plate.is_manual && <Text style={styles.manualBadge}>MANUAL</Text>}
            </View>
            <View style={styles.infoContainer}>
                <Text style={styles.dateText}>{formattedDate}</Text>
                {onDelete && (
                    <TouchableOpacity
                        onPress={() => onDelete(plate.id)}
                        style={styles.deleteButton}>
                        <Text style={styles.deleteText}>Usuń</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginHorizontal: 16,
        marginVertical: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    plateContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    plateNumber: {
        fontSize: 22,
        fontWeight: '700',
        color: '#1A1A1A',
        letterSpacing: 2,
    },
    manualBadge: {
        marginLeft: 12,
        backgroundColor: '#3B82F6',
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '600',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        overflow: 'hidden',
    },
    infoContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    dateText: {
        fontSize: 14,
        color: '#6B7280',
    },
    deleteButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    deleteText: {
        color: '#EF4444',
        fontSize: 14,
        fontWeight: '500',
    },
});

export default PlateItem;
