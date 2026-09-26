import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Platform,
  StatusBar,
  TextInput,
  TouchableOpacity,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
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
import { useBranch } from '../../context/BranchContext';
import { Colors } from '../../theme/colors';
import { getErrorMessage } from '../../api/client';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const ProductsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { addToCart, itemCount } = useCart();
  const { branches, selectedBranchId, selectedBranch, selectBranch, isLoadingBranches } = useBranch();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [addingProductId, setAddingProductId] = useState<string | null>(null);
  const [isBranchModalVisible, setIsBranchModalVisible] = useState<boolean>(false);

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
          branchId: selectedBranchId || undefined,
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
  }, [selectedCategoryId, searchQuery, selectedBranchId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

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
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
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

      {/* Branch Selector Bar */}
      <View style={styles.branchBarContainer}>
        <TouchableOpacity
          style={styles.branchBar}
          onPress={() => setIsBranchModalVisible(true)}
          activeOpacity={0.7}
        >
          <View style={styles.branchIconWrapper}>
            <Ionicons name="location" size={16} color={Colors.primary} />
          </View>
          <View style={styles.branchTextContainer}>
            <Text style={styles.branchLabel}>Sucursal para tu pedido</Text>
            <Text style={styles.branchName} numberOfLines={1}>
              {selectedBranch ? selectedBranch.name : (isLoadingBranches ? 'Cargando sucursal...' : 'Seleccionar sucursal')}
            </Text>
          </View>
          <View style={styles.branchChangeBadge}>
            <Text style={styles.branchChangeText}>Cambiar</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
          </View>
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

      {/* Branch Selection Modal */}
      <Modal
        visible={isBranchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsBranchModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsBranchModalVisible(false)}
        >
          <TouchableOpacity
            style={styles.modalContent}
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIcon}>
                <Ionicons name="business" size={20} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Sucursal de compra</Text>
                <Text style={styles.modalSubtitle}>
                  El stock y despacho del pedido corresponden a la sucursal elegida
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsBranchModalVisible(false)}
                style={styles.modalCloseBtn}
              >
                <Ionicons name="close" size={20} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.branchList}>
              {branches.length === 0 ? (
                <Text style={styles.emptyBranchText}>No hay sucursales disponibles.</Text>
              ) : (
                branches.map((branch) => {
                  const isSelected = branch.id === selectedBranchId;
                  return (
                    <TouchableOpacity
                      key={branch.id}
                      style={[
                        styles.branchOptionCard,
                        isSelected && styles.branchOptionCardSelected,
                      ]}
                      onPress={async () => {
                        await selectBranch(branch.id);
                        setIsBranchModalVisible(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={styles.branchOptionHeader}>
                        <Ionicons
                          name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={isSelected ? Colors.primary : Colors.textMuted}
                        />
                        <Text
                          style={[
                            styles.branchOptionTitle,
                            isSelected && styles.branchOptionTitleSelected,
                          ]}
                        >
                          {branch.name}
                        </Text>
                        {isSelected && (
                          <View style={styles.activePill}>
                            <Text style={styles.activePillText}>Seleccionada</Text>
                          </View>
                        )}
                      </View>

                      {branch.address && (
                        <View style={styles.branchOptionDetail}>
                          <Ionicons name="location-outline" size={13} color={Colors.textMuted} />
                          <Text style={styles.branchOptionAddress}>{branch.address}</Text>
                        </View>
                      )}

                      {branch.phone && (
                        <View style={styles.branchOptionDetail}>
                          <Ionicons name="call-outline" size={13} color={Colors.textMuted} />
                          <Text style={styles.branchOptionPhone}>{branch.phone}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
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
  branchBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  branchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  branchIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  branchTextContainer: {
    flex: 1,
  },
  branchLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  branchName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 1,
  },
  branchChangeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: 6,
  },
  branchChangeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 6,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  modalHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  branchList: {
    gap: 10,
    marginTop: 4,
  },
  emptyBranchText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 16,
  },
  branchOptionCard: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: 14,
    backgroundColor: Colors.surface,
  },
  branchOptionCardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  branchOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  branchOptionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    flex: 1,
  },
  branchOptionTitleSelected: {
    color: Colors.primary,
  },
  activePill: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textWhite,
  },
  branchOptionDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingLeft: 28,
  },
  branchOptionAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
  },
  branchOptionPhone: {
    fontSize: 12,
    color: Colors.textMuted,
  },
});
