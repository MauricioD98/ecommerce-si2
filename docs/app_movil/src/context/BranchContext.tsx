import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Branch, branchesApi } from '../api/branches.api';
import { appStorage } from '../utils/storage';

const STORAGE_SELECTED_BRANCH_KEY = '@selected_branch_id';

interface BranchContextType {
  branches: Branch[];
  selectedBranchId: string | null;
  selectedBranch: Branch | null;
  isLoadingBranches: boolean;
  selectBranch: (branchId: string) => Promise<void>;
  refreshBranches: () => Promise<void>;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export const BranchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [isLoadingBranches, setIsLoadingBranches] = useState<boolean>(true);

  const loadBranches = useCallback(async () => {
    try {
      setIsLoadingBranches(true);
      const activeBranches = await branchesApi.getActive();
      setBranches(activeBranches);

      const savedBranchId = await appStorage.getItem(STORAGE_SELECTED_BRANCH_KEY);

      if (activeBranches.length > 0) {
        if (savedBranchId && activeBranches.some((b) => b.id === savedBranchId)) {
          setSelectedBranchId(savedBranchId);
        } else {
          // Si no hay o ya no existe, usar la primera activa por defecto
          const defaultBranchId = activeBranches[0].id;
          setSelectedBranchId(defaultBranchId);
          await appStorage.setItem(STORAGE_SELECTED_BRANCH_KEY, defaultBranchId);
        }
      } else {
        setSelectedBranchId(null);
      }
    } catch (err) {
      console.warn('Error loading branches in BranchContext:', err);
    } finally {
      setIsLoadingBranches(false);
    }
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const selectBranch = async (branchId: string) => {
    setSelectedBranchId(branchId);
    try {
      await appStorage.setItem(STORAGE_SELECTED_BRANCH_KEY, branchId);
    } catch {
      // Ignorar fallo de almacenamiento
    }
  };

  const selectedBranch = useMemo(() => {
    return branches.find((b) => b.id === selectedBranchId) || null;
  }, [branches, selectedBranchId]);

  return (
    <BranchContext.Provider
      value={{
        branches,
        selectedBranchId,
        selectedBranch,
        isLoadingBranches,
        selectBranch,
        refreshBranches: loadBranches,
      }}
    >
      {children}
    </BranchContext.Provider>
  );
};

export const useBranch = (): BranchContextType => {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error('useBranch must be used within a BranchProvider');
  }
  return context;
};
