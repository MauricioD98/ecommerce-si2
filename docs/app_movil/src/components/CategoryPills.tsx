import React from 'react';
import {
  ScrollView,
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { Category } from '../types';
import { Colors } from '../theme/colors';

interface CategoryPillsProps {
  categories: Category[];
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  containerStyle?: ViewStyle;
}

export const CategoryPills: React.FC<CategoryPillsProps> = ({
  categories,
  selectedCategoryId,
  onSelectCategory,
  containerStyle,
}) => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, containerStyle]}
    >
      <TouchableOpacity
        style={[
          styles.pill,
          selectedCategoryId === null && styles.pillActive,
        ]}
        onPress={() => onSelectCategory(null)}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.pillText,
            selectedCategoryId === null && styles.pillTextActive,
          ]}
        >
          Todos
        </Text>
      </TouchableOpacity>

      {categories.map((cat) => {
        const isSelected = selectedCategoryId === cat.id;
        return (
          <TouchableOpacity
            key={cat.id}
            style={[styles.pill, isSelected && styles.pillActive]}
            onPress={() => onSelectCategory(isSelected ? null : cat.id)}
            activeOpacity={0.7}
          >
            <Text style={[styles.pillText, isSelected && styles.pillTextActive]}>
              {cat.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  pillTextActive: {
    color: Colors.textWhite,
  },
});
