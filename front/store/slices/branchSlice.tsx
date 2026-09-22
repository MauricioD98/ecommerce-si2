import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface BranchState {
    selectedBranchId: string | null;
}

const initialState: BranchState = {
    selectedBranchId: null,
};

const branchSlice = createSlice({
    name: "branch",
    initialState,
    reducers: {
        setSelectedBranch: (state: BranchState, action: PayloadAction<string | null>) => {
            state.selectedBranchId = action.payload;
        },
        clearSelectedBranch: (state: BranchState) => {
            state.selectedBranchId = null;
        },
    },
});

export const { setSelectedBranch, clearSelectedBranch } = branchSlice.actions;
export default branchSlice.reducer;
