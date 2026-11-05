// Puntos de falla para forzar intercalados y caídas en las pruebas de aceptación. Fuera de NODE_ENV=test
// no hay ningún hook registrado y failpoint() no hace nada: no existe forma de activarlos en producción.
type Hook = () => Promise<void> | void;

const hooks = new Map<string, Hook>();

export function setFailpoint(name: string, hook: Hook): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('Los failpoints solo existen con NODE_ENV=test');
  hooks.set(name, hook);
}

export function clearFailpoints(): void {
  hooks.clear();
}

export async function failpoint(name: string): Promise<void> {
  if (hooks.size === 0) return;
  await hooks.get(name)?.();
}
