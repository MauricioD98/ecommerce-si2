import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  SafeAreaView,
  Platform,
  StatusBar,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../../navigation/types';
import { Product, Category } from '../../types';
import { productsApi } from '../../api/products.api';
import { categoriesApi } from '../../api/categories.api';
import { ProductCard } from '../../components/ProductCard';
import { CategoryPills } from '../../components/CategoryPills';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { EmptyState } from '../../components/EmptyState';
import { useCart } from '../../context/CartContext';
import { Colors } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const ProductsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { addToCart, itemCount } = useCart();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [addingProductId, setAddingProductId] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      const [categoriesRes, productsRes] = await Promise.all([
        categoriesApi.getAll(),
        productsApi.getAll({
          category: selectedCategoryId || undefined,
          search: searchQuery.trim() || undefined,
          limit: 50,
        }),
      ]);

      setCategories(categoriesRes);
      setProducts(productsRes.data || []);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedCategoryId, searchQuery]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddToCart = async (product: Product) => {
    try {
      setAddingProductId(product.id);
      await addToCart(product.id, 1);
      Alert.alert('¡Agregado!', `"${product.name}" se agregó al carrito.`);
    } catch (err) {
      Alert.alert('Error', getErrorMessage(err));
    } finally {
      setAddingProductId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Top Bar with Brand & Cart shortcut */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.brandTitle}>Catálogo</Text>
          <Text style={styles.brandSubtitle}>Explora nuestros productos</Text>
        </View>

        <TouchableOpacity
          style={styles.cartIconBtn}
          onPress={() => navigation.navigate('Main', { screen: 'CartTab' } as any)}
          activeOpacity={0.7}
        >
          <Ionicons name="cart-outline" size={24} color={Colors.textPrimary} />
          {itemCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{itemCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar productos por nombre o SKU..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Categories Horizontal Selector */}
      <View style={styles.categoriesSection}>
        <CategoryPills
          categories={categories}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={setSelectedCategoryId}
        />
      </View>

      {/* Product Grid */}
      {isLoading ? (
        <LoadingSpinner message="Cargando productos..." fullScreen />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadData(true)}
              colors={[Colors.primary]}
            />
          }
          renderItem={({ item }) => (
            <ProductCard
              product={item}
              onPress={() =>
                navigation.navigate('ProductDetail', { productId: item.id })
              }
              onAddToCart={() => handleAddToCart(item)}
              isAddingToCart={addingProductId === item.id}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="No encontramos productos"
              description={
                searchQuery || selectedCategoryId
                  ? 'Prueba con otro término de búsqueda o cambia la categoría.'
                  : 'Aún no hay productos registrados en el catálogo.'
              }
              actionTitle={searchQuery || selectedCategoryId ? 'Limpiar Filtros' : undefined}
              onAction={() => {
                setSearchQuery('');
                setSelectedCategoryId(null);
              }}
            />
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  brandSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  cartIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: Colors.textWhite,
    fontSize: 11,
    fontWeight: '800',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  categoriesSection: {
    marginBottom: 4,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },
  columnWrapper: {
    justifyContent: 'space-between',
  },
});
