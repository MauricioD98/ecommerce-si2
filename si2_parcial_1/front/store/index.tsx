import { combineReducers, configureStore } from "@reduxjs/toolkit";
import { useDispatch } from "react-redux";
import { persistReducer, persistStore } from "redux-persist";
import createWebStorage from "redux-persist/es/storage/createWebStorage"
import authReducer from './slices/authSlices'
import cartReducer from './slices/cartSlice';
import branchReducer from './slices/branchSlice';

const createNoopStorage = () => {
    return {
        getItem() {
            return Promise.resolve(null);
        },
        setItem(value: string) {
            return Promise.resolve(value);
        },
        removeItem() {
            return Promise.resolve();
        }
    }
}
const storage =
    typeof window !== "undefined"
        ? createWebStorage("local")
        : createNoopStorage();



const persistConfig = {
    key: 'root',
    storage,
    whitelist: ["cart", "auth", "branch"],
}

const rootReducer = combineReducers({
    auth: authReducer,
    cart: cartReducer,
    branch: branchReducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);
export const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredActions: ["persist/PERSIST", "persis/REHYDRATE"],

            }
        })
});

export type AppDispatch = typeof store.dispatch;
export const persistor = persistStore(store);
export const useAppDispatch = () => useDispatch<AppDispatch>();
export type IRootState = ReturnType<typeof store.getState>