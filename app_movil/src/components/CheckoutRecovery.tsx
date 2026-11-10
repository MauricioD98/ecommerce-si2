import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { recoverAttempts } from '../utils/checkoutAttempts';

const POLL_MS = 30_000;

// Recupera las compras con resultado incierto de la cuenta actual al arrancar, al volver a primer plano y
// periódicamente mientras la app está abierta. No usa tareas en background: el sistema puede detenerlas, y
// la garantía real es que al reabrir la app se consulta y se reintenta con la misma clave.
export const CheckoutRecovery = () => {
  const { user, isAuthenticated } = useAuth();
  const running = useRef(false);
  const userId = isAuthenticated ? (user as { id?: string } | null)?.id : undefined;

  useEffect(() => {
    if (!userId) return;
    const recover = async () => {
      if (running.current || AppState.currentState !== 'active') return;
      running.current = true;
      try {
        await recoverAttempts(userId);
      } catch {
        // Sin almacenamiento o sin red: lo confirmado por el servidor sigue a salvo y se reintenta luego
      } finally {
        running.current = false;
      }
    };
    recover();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') recover();
    });
    const timer = setInterval(recover, POLL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [userId]);

  return null;
};
